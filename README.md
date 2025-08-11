# simple-cookie-session

todo:
- test race condition
- catch when selectSession throws

Cookie session management for javascript servers.

## Notes

- CSRF and cookie tampering is not included, and should be performed before using

## Garbage Collection
not implemented in this library because not security relevant.     

## Comparison with Device Bound Session Credentials

- DBSC will only invalidate attacker
- DBSC doesnt require storing all past session tokens

## CSRF

## Session Tampering / User Agent Detection / GeoIP

## What this library is not

- Protecting from malware continuously stealing cookies 

## Improving security with service workers

- By periodically refreshing the session cookie, you can detect cookie theft faster

## Delete cookie after browser close

## LICENCE

```
Zero-Clause BSD
=============

Permission to use, copy, modify, and/or distribute this software for
any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL
WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLEs
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
