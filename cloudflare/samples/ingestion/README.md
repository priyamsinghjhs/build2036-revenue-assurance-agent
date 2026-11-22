# Synthetic clearing and settlement samples

Deterministic parsers in the Worker consume these files. Raw bytes are **never** sent to an LLM.

| File | Kind | Notes |
|------|------|--------|
| `camt053_sample.xml` | ISO 20022 camt.053 | `MsgId`, `EndToEndId`, `IntrBkSttlmAmt`+Ccy, `ChrgsInf` intermediary charges, `RmtInf/Strd` |
| `npci_upi_ntsc_sample.txt` | NPCI UPI / NTSL-style | Pipe-delimited; 12-digit RRN, UPI txn id, response codes, P2M/P2P, RuPay credit and PPI flags |
| `mastercard_ipm_sample.bin` | Simplified Mastercard IPM | 2-byte RDW + EBCDIC (cp500) body with DE4/DE5, PDS 0158 IRD, PDS 0146 fees |
| `visa_baseii_sample.bin` | Simplified Visa BASE II | 80-byte EBCDIC (cp500) TCR0 / TCR1 / TCR5 records |

Rates used in the checks (RuPay Credit on UPI MDR above ₹2,000, PPI interchange 1.1% on eligible MCCs, FX markup cap) are **illustrative** and labelled as such in the app. They are not official scheme tariffs.
