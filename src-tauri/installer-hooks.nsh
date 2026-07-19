; "Open in Pide" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInPide" "" "Open in Pide"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInPide" "Icon" '"$INSTDIR\pide.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInPide" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInPide\command" "" '"$INSTDIR\pide.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInPide" "" "Open in Pide"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInPide" "Icon" '"$INSTDIR\pide.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInPide" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInPide\command" "" '"$INSTDIR\pide.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInPide" "" "Open in Pide"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInPide" "Icon" '"$INSTDIR\pide.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInPide" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInPide\command" "" '"$INSTDIR\pide.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInPide"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInPide"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInPide"
!macroend
