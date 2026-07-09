UPDATE users
SET profile_accent_color = '#5865F2'
WHERE profile_accent_color IS NULL
   OR TRIM(profile_accent_color) = '';

UPDATE users
SET profile_background_color = '#161A22'
WHERE profile_background_color IS NULL
   OR TRIM(profile_background_color) = '';

UPDATE users
SET profile_accent_color = '#5865F2',
    profile_background_color = '#161A22'
WHERE UPPER(TRIM(COALESCE(profile_accent_color, ''))) = '#0B0BE6'
  AND UPPER(TRIM(COALESCE(profile_background_color, ''))) = '#0055FE';
