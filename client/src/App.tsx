import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import UserManagement from "./pages/UserManagement";
import PublishProjections from "./pages/PublishProjections";
import IngestAnOdds from "./pages/IngestAnOdds";
import ModelProjections from "./pages/ModelProjections";
import BettingSplitsPage from "./pages/BettingSplits";

function Router() {
  return (
    <Switch>
      {/* Public paywall landing — default entry point */}
      <Route path="/" component={Home} />
      {/* Legacy redirects */}
      <Route path="/dashboard">{() => <Redirect to="/feed" />}</Route>
      <Route path="/projections">{() => <Redirect to="/feed" />}</Route>
      {/* /splits → dedicated Betting Splits page */}
      <Route path="/splits">{() => <Redirect to="/betting-splits" />}</Route>
      {/* Unified feed page (AI Model Projections) */}
      <Route path="/feed" component={ModelProjections} />
      {/* Dedicated Betting Splits page — all 4 sports */}
      <Route path="/betting-splits" component={BettingSplitsPage} />
      {/* Legacy /login redirect to home */}
      <Route path="/login">{() => <Redirect to="/" />}</Route>
      <Route path="/admin/users" component={UserManagement} />
      <Route path="/admin/publish" component={PublishProjections} />
      <Route path="/admin/ingest-an" component={IngestAnOdds} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
