const driveMetadataScope = 'https://www.googleapis.com/auth/drive.metadata.readonly';

async function canAccessWaltonDriveFolder (accessToken) {
  const folderId = process.env.WALTON_DRIVE_FOLDER_ID;
  if (!folderId) {
    return true;
  }

  if (!accessToken) {
    return false;
  }

  const params = new URLSearchParams({
    fields: 'id,name,mimeType',
    supportsAllDrives: 'true'
  });

  let response;
  try {
    response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch (err) {
    console.error('/api/auth: GOOGLE DRIVE AUTH CHECK FAILED:', err);
    return false;
  }

  if (!response.ok) {
    console.log(`/api/auth: GOOGLE DRIVE AUTH DENIED: folder=${folderId} status=${response.status}`);
    return false;
  }

  const file = await response.json();
  return file.mimeType === 'application/vnd.google-apps.folder';
}

async function isGoogleUserAuthorized (user) {
  return await canAccessWaltonDriveFolder(user.googleAccessToken);
}

export {
  driveMetadataScope,
  isGoogleUserAuthorized
};
