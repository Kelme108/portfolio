---
title: "Machine or Lab Name"
date: 2026-01-01
platform: Hack The Box            # Hack The Box · Blue Team Labs · TryHackMe · ...
category: Pentest                 # Pentest · Malware Analysis · Incident Response · ...
difficulty: Easy                  # Very Easy · Easy · Medium · Hard · Insane
os: Linux                         # target OS, or main tool for blue-team labs (e.g. Splunk)
image: /assets/writeups/slug/cover.png
description: >-
  One or two sentences (~160 chars) summarising the attack chain or investigation.
  Used on cards, search results and as the SEO meta description.
tags: [tag-one, tag-two, tool-name, technique]
---

## Overview

What the target is, what the goal was and the path you took, in one paragraph.

---

## Reconnaissance

```bash
nmap -sC -sV -Pn 10.10.10.10
```

![Nmap results showing ports 22 and 80 open]({{ '/assets/writeups/slug/image-1.png' | relative_url }})

*Short caption explaining what the screenshot proves.*

## Exploitation

## Privilege Escalation

## Findings Summary

| Step | Technique | MITRE ATT&CK |
|---|---|---|
| Initial access | ... | T1190 — Exploit Public-Facing Application |

## Lessons Learned / Detection & Mitigation

- How a defender would detect this.
- How to fix it.
