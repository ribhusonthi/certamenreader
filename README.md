ReadME

## Google Drive Access Gate

Set `WALTON_DRIVE_FOLDER_ID` to restrict Google login to accounts that can access the Walton Certamen Google Drive folder. The app checks the logged-in user's Google OAuth access token against Drive `files.get` for that folder.

Required Google OAuth scope:

```txt
https://www.googleapis.com/auth/drive.metadata.readonly
```

If `WALTON_DRIVE_FOLDER_ID` is unset, Google login is unrestricted. Set it in production.
