---
layout: writeup
title: "Icemagic"
date: 2026-08-08
platform: Blue Teams Labs
difficulty: Medium
os: Ghidra (Reverse Engineering)
image: /assets/icemagicimage.png
---

## Overview

This lab focuses on the static reverse engineering of a Linux ransomware sample named **Icemagic**. The objective was to reconstruct the binary's internal logic entirely from its disassembled and decompiled form, using Ghidra as the primary analysis platform, combined with manual byte inspection, hexadecimal-to-ASCII conversion, and cryptographic analysis.

The investigation follows the natural flow of the binary itself: identifying the sample, understanding its expected command-line arguments, locating its command-and-control (C2) beacon logic, uncovering a time-based execution guard, decoding a hidden "secret command" that drops a ransom note, and finally reverse-engineering the XOR-based encryption scheme used to protect victim files. Each finding builds on the previous one, since the functions in the binary call into each other in a linear chain starting from `main`.

---

## Q1 — MD5 Hash

**Question:** What is the MD5 hash of the binary? *(Format: Hash)*

### Investigation

The first step in any static analysis workflow is to generate a hash of the sample for identification and integrity tracking. This was done by navigating to the directory containing the binary and running the standard hashing utility.

**Command:**
```bash
md5sum icemagic
```

**Result:**
```text
f0255dceafb40eabd3580a23939cf70c
```

This hash uniquely fingerprints the exact binary analyzed throughout the rest of the writeup, which is important for reproducibility — any deviation in this value would indicate a different sample or a modified copy.

**Answer:** `f0255dceafb40eabd3580a23939cf70c`

---

## Q2 — Expected Program Arguments

**Question:** How many "user" provided parameters is the binary expecting? *(Format: Number)*

### Investigation

To inspect the binary's logic, it was imported into Ghidra for static analysis of both the disassembly and the decompiled C-like pseudocode. Ghidra was launched from its installation directory:

```bash
chmod +x ghidraRun
./ghidraRun
```

As shown in Figure 1, launching Ghidra opens the tool so the binary can be imported into a new project for analysis.

![Figure 1 - Ghidra launched and ready for project/binary import]({{ '/assets/writeups/ice-magic/image.png' | relative_url }})

*Figure 1 — Ghidra opened after running `./ghidraRun`, ready to import the Icemagic binary for static analysis.*

Once the binary was imported, Figure 2 shows the resulting Ghidra project view with the sample loaded and available in the Symbol Tree.

![Figure 2 - Icemagic binary imported into a Ghidra project]({{ '/assets/writeups/icemagic/image-2.png' | relative_url }})

*Figure 2 — The Icemagic binary imported into Ghidra, ready for navigation through its functions.*

The **Symbol Tree → Functions** panel was then used to locate the `main` function — the entry point where the program's initialization logic begins. Selecting `main` populates the decompiler pane on the right-hand side with Ghidra's reconstructed C representation of the function, as illustrated in Figure 3.

![Figure 3 - Decompiled main function showing the argc == 2 check]({{ '/assets/writeups/icemagic/image-3.png' | relative_url }})

*Figure 3 — The `main` function selected in the Symbol Tree, with the decompiler showing the `argc == 2` argument-count check.*

Within `main`, the first meaningful control-flow check is:

```c
if (argc == 2)
```

In C, `argc` (argument count) always includes the path/name of the executable itself as the first element (`argv[0]`), meaning any value passed by the user starts at `argv[1]`. A value of `argc == 2` therefore indicates that the program requires **exactly one user-supplied argument** in addition to the program name — the binary must be invoked as `./icemagic <argument>`, and anything else (zero or more than one argument) falls outside the expected execution path.

**Answer:** `1`

---

## Q3 — Beacon IP and Port

**Question:** What is the IP address and port the artefact is reaching out to? *(Format: X.X.X.X:port)*

### Investigation

Continuing from the `argc == 2` check in `main`, the decompiled code branches into a function named `send_beacon`, whose name strongly suggests outbound command-and-control (C2) communication. As shown in Figure 4, this function is visible directly in the Functions list and can be clicked to jump to its decompiled body.

![Figure 4 - send_beacon function located in the Functions list]({{ '/assets/writeups/icemagic/image-4.png' | relative_url }})

*Figure 4 — The `send_beacon` function identified in Ghidra's function listing, indicating possible C2 communication logic.*

Jumping into the function reveals the socket setup and connection logic, including the destination IP address literal, as shown in Figure 5.

![Figure 5 - Decompiled send_beacon code showing the destination IP address]({{ '/assets/writeups/icemagic/image-5.png' | relative_url }})

*Figure 5 — Decompiled `send_beacon` code showing the socket structure being populated with the destination IP address.*

The destination port, however, is passed through the `htons()` function before being assigned to the socket structure. Figure 6 shows the hexadecimal value passed into `htons()` as displayed by the decompiler.

![Figure 6 - htons() call with the hexadecimal port value]({{ '/assets/writeups/icemagic/image-6.png' | relative_url }})

*Figure 6 — The port value passed to `htons()`, shown in hexadecimal form and requiring conversion to obtain the decimal port number.*

`htons()` stands for **"host to network short"**. It converts a 16-bit value from the host machine's byte order (which on most x86/x86-64 systems is little-endian) into network byte order (big-endian), because network protocols — including the `sockaddr_in` structure used by BSD sockets — always expect port and address fields in big-endian format. Since Ghidra displays the raw hexadecimal value that is passed into `htons()`, that value must be interpreted correctly to recover the actual decimal port number used by the socket connection, rather than reading the hex digits at face value.

After performing this conversion and reading the IP address literal from the same function, the full beacon destination was determined to be:

**Answer:** `198.51.100.4:33345`

---

## Q4 — Data Exfiltrated to the Attacker

**Question:** Data is sent back to the attacker. What was the data? *(Format: data;sent)*

### Investigation

Remaining inside `send_beacon`, the next relevant object is the variable `victim_id`, which is passed into a `write()` call — the standard POSIX system call used to send data over an already-connected socket file descriptor. Figure 7 shows this section of the decompiled function, confirming that `victim_id` is the payload transmitted back to the IP and port identified in Q3.

![Figure 7 - write() call transmitting victim_id over the socket]({{ '/assets/writeups/icemagic/image-7.png' | relative_url }})

*Figure 7 — The `write()` call inside `send_beacon`, sending the contents of `victim_id` back to the attacker's IP and port.*

However, Ghidra was unable to fully decompile the raw bytes backing `victim_id` into a clean string literal. Instead, it displayed the underlying memory as a block of raw bytes and their corresponding ASCII characters — a common situation when the decompiler cannot confidently resolve a data reference to a named string. This required manually interpreting ("cleaning") the bytes shown in that block by right-clicking the byte block and selecting the appropriate "interpret as string" option, as shown in Figure 8.

![Figure 8 - Ghidra right-click context menu used to interpret the raw bytes as a string]({{ '/assets/writeups/icemagic/image-8.png' | relative_url }})

*Figure 8 — Right-clicking the raw byte block in Ghidra to expose the option that interprets the memory contents as a string.*

The key point here is that these bytes must be read as a **null-terminated C string**: in C, a string is not defined by a length field but by a sequence of bytes terminated by the null byte `0x00`. Reading the raw byte block character-by-character and stopping at the terminator reconstructs the exact string that `write()` sends over the socket, without needing Ghidra to resolve it automatically. Applying this interpretation exposed the plaintext value directly, as shown in Figure 9.

![Figure 9 - Recovered plaintext string sent to the attacker]({{ '/assets/writeups/icemagic/image-9.png' | relative_url }})

*Figure 9 — The recovered plaintext string `target=snotrak;cipher=rail`, obtained after interpreting the raw bytes of `victim_id` as a null-terminated C string.*

The recovered string was:

```text
target=snotrak;cipher=rail
```

This single string is informative beyond just being the exfiltrated data: it already discloses a Rail Fence Cipher (`cipher=rail`) reference and a codename/target field (`target=snotrak`), both of which become directly relevant in later questions dealing with obfuscated filenames.

**Answer:** `target=snotrak;cipher=rail`

---

## Q5 — Execution Guard Function

**Question:** What is the function name that is used as an execution guard? *(Format: your_func_here)*

### Investigation

An **execution guard** is a routine that gates whether the rest of the malicious logic is allowed to run — it evaluates some condition and either continues execution or halts it. Reviewing the control flow inside `main` beyond the argument check shows two distinct branches:

```c
if (param_1 == 2) {
    send_beacon(...);
}
...
check_current_month();
```

The flow observed is: `main` first validates that exactly one user argument was supplied, and if that condition holds, it calls `send_beacon()`. Separately, before allowing the core malicious logic (file processing / encryption) to proceed, the binary calls `check_current_month()`, as visible in Figure 10.

![Figure 10 - check_current_month() called from main before the core payload logic]({{ '/assets/writeups/icemagic/image-10.png' | relative_url }})

*Figure 10 — The decompiled `main` function showing the call to `check_current_month()`, which gates whether the malicious file-processing logic is allowed to run.*

Because this function determines — based on an external, time-dependent condition — whether the rest of the program is permitted to execute, it functions as the execution guard for the malware's payload logic.

**Answer:** `check_current_month`

---

## Q6 — Target Month for the Guard

**Question:** What month is this function looking for? *(Format: Month)*

### Investigation

Following the call into `check_current_month()` from Q5, the decompiler shows the function retrieving the current system time and extracting its month component:

```c
local_38._0_4_ = ptVar1->tm_mon;
```

Here, `ptVar1->tm_mon` reads the month field from a populated `struct tm` (the standard C time structure returned by functions such as `localtime()`), and `local_38._0_4_` stores that value into the first four bytes of a local variable for later comparison. Descending further into the same function reveals the actual comparison against a fixed constant, as shown in Figure 11.

![Figure 11 - Decompiled comparison of the current month against 0xb]({{ '/assets/writeups/icemagic/image-11.png' | relative_url }})

*Figure 11 — The decompiled code comparing the extracted `tm_mon` value against `0xb`, the condition that gates execution to a specific month.*

```c
return (int)local_38 == 0xb;
```

The critical detail is that **`tm_mon` is zero-indexed**, meaning the twelve calendar months map as follows:

| tm_mon value | Month |
|---|---|
| `0` | January |
| `1` | February |
| ... | ... |
| `10` | November |
| `11` | December |

Since `0xb` in hexadecimal equals `11` in decimal, and `11` corresponds to the twelfth and final zero-indexed month, the comparison `(int)local_38 == 0xb` is checking whether the current month is **December**. This means the guard only allows the malicious file-processing logic to proceed during December, likely a thematic/seasonal trigger tied to the "Icemagic" / "Goblin" branding of the ransom note discovered later.

**Answer:** `December`

---

## Q7 — Secret Command to Drop the Ransom Note

**Question:** The ransom note can be dropped with a secret command. What is the command? *(Format: String)*

### Investigation

Beyond the primary encryption workflow, the binary contains a `strcmp()` comparison that checks the user-supplied argument against a reference value generated by a function called `conversion()`. This reference value is built from the hexadecimal sequence:

```text
0x72616e736f6d
```

Converting this hexadecimal value to ASCII character-by-character (`72`→`r`, `61`→`a`, `6e`→`n`, `73`→`s`, `6f`→`o`, `6d`→`m`) reconstructs the string `ransom`. Figure 12 shows the decompiled code implementing this `strcmp()` / `conversion()` comparison.

![Figure 12 - strcmp() comparison built from the conversion() function output]({{ '/assets/writeups/icemagic/image-12.png' | relative_url }})

*Figure 12 — The decompiled `strcmp()` comparison against the value produced by `conversion()`, which decodes to the hidden command `ransom`.*

When the user-supplied argument matches this decoded string, the resulting comparison satisfies the condition:

```c
iVar2 == 0
```

`strcmp()` returns `0` when the two compared strings are identical, so `iVar2 == 0` is the standard idiom for "the strings match." Once this condition is true, the routine responsible for generating the ransom note is triggered. Confirmation of this branch is visible in a subsequent call:

```c
use_secret_cipher(2, &ransom_filename);
```

The argument `2` here is the Rail Fence Cipher key later used to decode `ransom_filename` (see Q8), and the fact that this call sits directly inside the `ransom`-triggered branch confirms that supplying the hidden command `ransom` as the program's argument is what causes the malware to create and populate the ransom note file via subsequent `fopen()` and `fputs()` calls.

**Answer:** `ransom`

---

## Q8 — Ransom Note Filename

**Question:** What is the ransom note filename? *(Format: filename.extension)*

### Investigation

The ransom note's filename is derived from the variable `ransom_filename`, used in the same `use_secret_cipher(2, &ransom_filename)` call identified in Q7. Inspecting the raw bytes backing this variable in the assembly view, as shown in Figure 13, reveals the following sequence.

![Figure 13 - Raw assembly bytes stored in ransom_filename]({{ '/assets/writeups/icemagic/image-13.png' | relative_url }})

*Figure 13 — The raw bytes of `ransom_filename` as displayed in the assembly view: `72 6e 6f 2e 78 61 73 6d 74 74`.*

```text
72 6e 6f 2e 78 61 73 6d 74 74
```

Converting these bytes directly from hexadecimal to ASCII produces:

```text
rno.xasmtt
```

This string is not a coherent or valid filename, which is the expected outcome when a value has been deliberately scrambled before being stored — consistent with the `cipher=rail` marker recovered from the exfiltrated `victim_id` string in Q4, and with the `use_secret_cipher()` call wrapping this exact variable.

Applying a **Rail Fence Cipher** with key `2` to `rno.xasmtt` reorders the scrambled characters back into their original sequence. The Rail Fence Cipher is a transposition cipher: with key `2`, characters are written in a zigzag pattern across two "rails," and decoding requires reversing that same zigzag read order rather than substituting characters. Applying this decoding step to `rno.xasmtt` recovers the legitimate filename:

```text
ransom.txt
```

**Answer:** `ransom.txt`

---

## Q9 — Ransom Payment Address

**Question:** What is the ransom payment address? *(Format: String)*

### Investigation

With the target filename `ransom.txt` confirmed, the next step was extracting the full contents of the `ransom_note` variable directly from the binary's data section, byte by byte, as shown in Figure 14.

![Figure 14 - Raw bytes of ransom_note extracted from the data section]({{ '/assets/writeups/icemagic/image-14.png' | relative_url }})

*Figure 14 — The raw byte sequence of `ransom_note` copied from Ghidra's memory view, prior to decoding.*

These bytes were fed into CyberChef using the same Rail Fence Cipher (key `2`) decoding recipe validated in Q8. The first decoding attempt produced a message with corrupted or incorrect characters at the very end, as shown in Figure 15.

![Figure 15 - Initial CyberChef decoding attempt with corrupted trailing characters]({{ '/assets/writeups/icemagic/image-15.png' | relative_url }})

*Figure 15 — Initial Rail Fence Cipher decoding attempt in CyberChef, showing corrupted characters at the end of the message.*

Investigating this discrepancy revealed that the byte sequence copied from the data section included three trailing null bytes (`00 00 00`) that were not part of the actual message content.

This is directly explained by how C strings are represented in memory: the byte `0x00` functions as the **null terminator**, marking the logical end of a string regardless of how much memory has been allocated for it. When a fixed-size buffer is used to store a shorter string, the unused trailing bytes are typically zero-filled; including those trailing zero bytes in the CyberChef input caused the Rail Fence decoding routine to process extra "characters" that did not belong to the real message, corrupting the output near the end.

After manually trimming the three trailing `00 00 00` bytes from the extracted data and re-running the same decoding recipe, the message was reconstructed cleanly, as shown in Figure 16.

![Figure 16 - Corrected CyberChef decoding after removing the trailing null bytes]({{ '/assets/writeups/icemagic/image-16.png' | relative_url }})

*Figure 16 — The corrected Rail Fence Cipher decoding in CyberChef after removing the trailing `00 00 00` bytes, producing a clean ransom note.*

```text
Goblin greetings,

We have frozen your precious files!
...
GL4CI3RG0LDC01NVAULT
```

The final line of the decoded note, `GL4CI3RG0LDC01NVAULT`, is the ransom payment address/identifier demanded by the attacker.

**Answer:** `GL4CI3RG0LDC01NVAULT`

---

## Q10 — Cipher Used to Obfuscate the Ransom Note

**Question:** What is the cipher name that the goblins are using to obfuscate the ransom note? *(Format: xxxx xxxxx)*

### Investigation

The function `secret_cipher()` is responsible for obfuscating string constants stored inside the binary, including both `ransom_filename` and `ransom_note`. This was confirmed empirically across two independent data points:

- `ransom_filename`, when read as raw bytes, produced the garbled string `rno.xasmtt`, which only became a valid filename (`ransom.txt`) after applying **Rail Fence Cipher** decoding with key `2` (Figure 13, Q8).
- `ransom_note`, when extracted and decoded using the same Rail Fence Cipher and key, reconstructed a fully coherent, grammatically correct ransom message (Figures 14–16, Q9).

Since the same decoding algorithm and key successfully reversed the obfuscation on two separate strings pulled from two different parts of the binary, this consistency confirms that the Rail Fence Cipher is the specific obfuscation method used throughout the malware for hiding its embedded string data — not merely a coincidental match for one string.

**Answer:** `Rail Fence`

---

## Q11 — File Access Mode for Target Files

**Question:** What mode is used to read target files? *(Format: xx)*

### Investigation

Reviewing the file I/O logic used to process victim files reveals the following `fopen()` call, shown decompiled in Figure 17:

![Figure 17 - Decompiled fopen() call opening target files in "wb" mode]({{ '/assets/writeups/icemagic/image-17.png' | relative_url }})

*Figure 17 — The decompiled `fopen()` call, showing the target file opened in `"wb"` (write binary) mode.*

```c
local_68 = fopen(*(char **)(param_2 + 8), "wb");
```

The mode string `"wb"` stands for **write binary**. Opening a file in `"w"` mode truncates any existing content and allows new data to be written from the beginning of the file; the `"b"` modifier disables any platform-specific text-mode translation (such as newline conversion), ensuring that every byte written is stored exactly as provided, with no alteration. This is essential for a routine that overwrites a target file with encrypted binary output, since any implicit translation would corrupt non-text byte sequences.

This finding is directly consistent with ransomware behavior: the original file content is not preserved separately — it is overwritten in place by the encryption routine using this same file handle, opened specifically to accept raw binary writes.

**Answer:** `wb`

---

## Q12 — Function Used to Determine File Size

**Question:** Which function is used to determine the target file's size? *(Format: func)*

### Investigation

To process an entire file (for example, to read it fully into a buffer before encrypting it), the malware first needs to know its total size. The decompiled logic, shown in Figure 18, accomplishes this with a two-step sequence.

![Figure 18 - Decompiled fseek() and ftell() calls used to determine file size]({{ '/assets/writeups/icemagic/image-18.png' | relative_url }})

*Figure 18 — The decompiled code showing `fseek()` moving the cursor to the end of the file, followed by `ftell()` returning the resulting offset.*

```c
fseek(fp, 0, SEEK_END);
size = ftell(fp);
```

`fseek()` repositions the file's internal read/write cursor to an arbitrary offset; using the `SEEK_END` flag together with an offset of `0` moves the cursor to the very last byte of the file. `ftell()` then returns the **current position of that cursor**, expressed as a byte offset from the beginning of the file. Because the cursor has just been moved to the end of the file, the value returned by `ftell()` is numerically equal to the total size of the file in bytes.

This `fseek()` + `ftell()` pattern is a standard, portable C idiom for determining file size without relying on OS-specific APIs such as `stat()`, and it directly supports the malware's subsequent step of allocating a correctly sized buffer to read the entire target file for encryption.

**Answer:** `ftell`

---

## Q13 — Magic Number Identifying Already-Encrypted Files

**Question:** What are the magic numbers that identify this encrypted file? *(Format: 0xSomething)*

### Investigation

Before encrypting a file, the malware checks whether it has already been processed, in order to avoid re-encrypting its own output. This check is performed by reading the first seven bytes of the target file using `fread()` and comparing them against a locally computed reference value.

That reference value — the **magic number** — is not hardcoded directly; instead, it is derived at runtime by XOR-ing two constants together, as shown in the decompiled code in Figure 19.

![Figure 19 - Decompiled XOR operation computing the encrypted-file magic number]({{ '/assets/writeups/icemagic/image-19.png' | relative_url }})

*Figure 19 — The decompiled code computing the magic number by XOR-ing the constants `0x4b72616d70776e` and `0x476c6163696572`.*

```c
local_58 = 0x4b72616d70776e;
local_50 = local_58 ^ 0x476c6163696572;
```

Performing this XOR operation manually:

```text
  0x4b72616d70776e
XOR 0x476c6163696572
= 0x0c1e000e19121c
```

A magic number is a fixed byte sequence placed at a specific offset in a file (commonly the header) purely to identify the file's format or state. In this case, the value `0x0c1e000e19121c` serves exactly that purpose: if the seven bytes read from the beginning of the target file match this XOR result, the malware concludes the file has already been encrypted and displays the message `"The file is already enkrypted"`, skipping re-encryption. This means the magic number functions as an in-band flag embedded by the ransomware itself, written into every file it encrypts, allowing the malware to track its own progress across a filesystem without maintaining external state.

**Answer:** `0x0c1e000e19121c`

---

## Q14 — Recovering the Encrypted Employee Details

**Question:** After decoding the encrypted employee details, what is Candy Cane's occupation? *(Format: String)*

### Investigation

The same value identified in Q13, `0x0c1e000e19121c`, serves a dual purpose in this malware: it acts both as the **magic number** used to detect already-encrypted files, and — because it was originally produced as an XOR result — it doubles as the **encryption/decryption key** itself. This is a direct consequence of how XOR encryption works: XOR is a reversible, symmetric operation, meaning that applying the exact same key a second time to ciphertext reverses the original operation and restores the plaintext (`plaintext XOR key XOR key == plaintext`).

Following this logic, the encrypted employee-details file was fed into CyberChef with a byte-wise XOR operation using `0x0c1e000e19121c` as the key, successfully recovering readable plaintext content from the ciphertext, as shown in Figure 20.

![Figure 20 - CyberChef XOR decryption of the encrypted employee details using the magic number as the key]({{ '/assets/writeups/icemagic/image-20.png' | relative_url }})

*Figure 20 — CyberChef performing a byte-wise XOR decryption of the encrypted employee details, using `0x0c1e000e19121c` (the magic number from Q13) as the key.*

This confirms both the mechanism (single-key repeating or fixed-length XOR) and the reuse pattern (identifier value doubling as decryption key) employed by the malware for this secondary data-protection routine.

However, the source material provided for this analysis documents the decryption methodology and confirms that legible plaintext was recovered, but it does **not** include the specific decoded text disclosing Candy Cane's occupation. Consistent with the accuracy requirement of this writeup, that specific value is not stated here, since asserting it would require information not present in the available notes.

**Answer:** Decryption method confirmed (XOR with key `0x0c1e000e19121c` reused from the magic number); the specific occupation value is not present in the available material and is therefore not stated.

---

## Findings Summary

| Question | Finding |
|---|---|
| Q1 | MD5 hash: `f0255dceafb40eabd3580a23939cf70c` |
| Q2 | Binary expects `1` user-supplied argument (`argc == 2`) |
| Q3 | Beacon destination: `198.51.100.4:33345` |
| Q4 | Exfiltrated data: `target=snotrak;cipher=rail` |
| Q5 | Execution guard function: `check_current_month` |
| Q6 | Guard triggers in `December` (`tm_mon == 0xb`) |
| Q7 | Secret command to drop ransom note: `ransom` |
| Q8 | Ransom note filename: `ransom.txt` |
| Q9 | Ransom payment address: `GL4CI3RG0LDC01NVAULT` |
| Q10 | Obfuscation cipher: `Rail Fence` (key 2) |
| Q11 | Target file access mode: `wb` |
| Q12 | File size determined via `fseek()` + `ftell()` |
| Q13 | Magic number: `0x0c1e000e19121c` |
| Q14 | Magic number reused as XOR decryption key; occupation not present in source notes |

---

## Tools & Techniques

- **Ghidra** — static disassembly and C pseudocode decompilation of the ELF binary.
- **md5sum** — sample hashing for identification.
- **CyberChef** — Rail Fence Cipher decoding and XOR decryption of extracted byte sequences.
- **Manual hex-to-ASCII conversion** — recovering obfuscated strings and constants from raw byte sequences shown in Ghidra.
