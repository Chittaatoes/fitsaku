# Exercise media: personal, non-commercial use

FitSaku ships the exercise stills and animations (`catalogue/media/still`, `catalogue/media/clip`) that
belong to **Gym visual** (Aliaksandr Makatserchyk, gymvisual.com) and are licensed to the openGym project,
not under the AGPL. `NOTICE.md` says: *a non-commercial fork of openGym may keep the unmodified 180 px
media together with this notice. A commercial fork, or any other use, needs its own licence from gymvisual.com.*

The owner of this deployment has decided to keep the media and states that:

- this FitSaku instance is for **personal, non-commercial** use (the owner's own training programme);
- the media is used **unmodified**, at the size shipped in `catalogue/media`, **with its licence notice**
  (`catalogue/media/NOTICE.md`, copied next to the files, and the attribution in Settings > About);
- nothing is sold, no subscription or advertising is attached to it, and the media is not extracted, resold,
  fed to any AI system, or reused in another product;
- if the use ever becomes commercial, or the site is offered to the public as a service, the media must be
  removed first (set `VITE_BUNDLE_MEDIA` to `0` / `VITE_BUILTIN_MEDIA=0`, delete this file) or a licence obtained
  from gymvisual.com.

This is the owner's own reading of the notice, not legal advice and not a licence from Gym visual. Opening
sign-up to anyone makes the "personal" claim harder to defend; the owner accepts that risk.

The deployment audit (`scripts/audit-public-artifacts.mjs`) allows the media **only while this file exists**.
Delete it and the audit, `.gitignore` rules and the Docker defaults go back to excluding the media.
