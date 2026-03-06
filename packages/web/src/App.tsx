import { DashboardLayout } from './components/DashboardLayout.js';

export function App() {
  const today = new Date().toISOString().split('T')[0];

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <DashboardLayout
        competitionId="comp:football-data:PD"
        dateLocal={today}
        timezone="America/Montevideo"
      />
    </div>
  );
}
