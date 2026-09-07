import { ErrorBoundary } from '@/components/error-boundary';
import { EchoMazeDashboard } from '@/components/echo-maze-dashboard';

function App() {
  return (
    <ErrorBoundary>
      <EchoMazeDashboard />
    </ErrorBoundary>
  );
}

export default App;
