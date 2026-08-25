export const homeCommands = [
  {
    id: 'user',
    title: 'Account',
    icon: 'account',
    section: 'Accounts',
  },
  {
    id: 'user_account-settings',
    title: 'Account Settings',
    icon: 'settings',
    parent: 'user',
    section: 'Account',
    handler: () => {
      navigateTo('/account/profile')
    },
  },
  {
    id: 'user_account-logout',
    title: 'Logout',
    icon: 'signout',
    parent: 'user',
    section: 'Account',
    handler: () => {},
  },
  {
    id: 'user_account-rowweave',
    title: 'RowWeave on GitHub',
    icon: 'github',
    parent: 'user',
    section: 'Community',
    handler: () => {
      navigateTo('https://github.com/geniuskey/rowweave', { external: true })
    },
  },
]

/*
  Here is a list of all the available commands defined throughout the app.
  Commands prefixed with a '-' are static commands that are always available.
  Commands prefixed with a '+' are dynamic commands that are only available when the user is in a specific context.
  Commands prefixed with a '*' are scopes

  Commands:
    * home (Navigate Home)
    + workspaces (Workspaces - EE)
    + bases (Projects)
    * workspace (Workspace - EE)
      + tables (Tables)
      + views (Views)
    * account_settings (Account Settings)
      * account_settings-users (Users)
        - account_settings-users-reset_password (Reset Password)
      - account_settings-tokens (Tokens)
*/
