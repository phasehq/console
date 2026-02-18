export const printConsoleBranding = () => {
  console.log(
    `%c
             /$$
            | $$
    /$$$$$$ | $$$$$$$   /$$$$$$   /$$$$$$$  /$$$$$$
   /$$__  $$| $$__  $$ |____  $$ /$$_____/ /$$__  $$
  | $$  \\ $$| $$  \\ $$  /$$$$$$$|  $$$$$$ | $$$$$$$$
  | $$  | $$| $$  | $$ /$$__  $$ \\____  $$| $$_____/
  | $$$$$$$/| $$  | $$|  $$$$$$$ /$$$$$$$/|  $$$$$$$
  | $$____/ |__/  |__/ \\_______/|_______/  \\_______/
  | $$
  |__/
`,
    'color: #00ff88; font-family: monospace'
  )
  console.log('%cStop!', 'color: #ff4444; font-size: 24px; font-weight: bold')
  console.log(
    '%cThis is a browser feature intended for developers. Do not paste any code or scripts here — it could compromise your account.',
    'color: #ffaa00; font-size: 14px'
  )
  console.log(
    '%cFeature requests: %chttps://github.com/phasehq/console/issues',
    'color: #888; font-size: 12px',
    'color: #58a6ff; font-size: 12px'
  )
  console.log(
    '%cNeed help? Join our Slack: %chttps://slack.phase.dev',
    'color: #888; font-size: 12px',
    'color: #58a6ff; font-size: 12px'
  )
}
