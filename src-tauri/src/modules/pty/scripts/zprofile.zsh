# pide-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _pide_user_zdotdir="${PIDE_USER_ZDOTDIR:-$HOME}"
  [ -f "$_pide_user_zdotdir/.zprofile" ] && source "$_pide_user_zdotdir/.zprofile"
  unset _pide_user_zdotdir
}
:
