import './globals.css';
import { BootGate } from './boot-gate';

export const metadata = { title: 'Sponsored Compute · purpose-bound grants on NEAR' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi"><body style={{ margin: 0 }}><BootGate>{children}</BootGate></body></html>;
}
