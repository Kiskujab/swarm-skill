import './globals.css';
// components/swarm-rebuild/ is copied from the skill's assets/ by scripts/run-tests.cjs (not committed),
// exactly as SKILL.md tells you to install it in a real project.
import SwarmRebuild, { SwarmRebuildHead } from '../components/swarm-rebuild/SwarmRebuild';

export const metadata = {
  title: 'Northwind Ledger',
  description: 'Fictional Next.js test app for page-swarm-rebuild'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <SwarmRebuildHead />
      </head>
      <body>
        {children}
        <a className="help" href="#contact">Help</a>
        <SwarmRebuild />
      </body>
    </html>
  );
}
