import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell.tsx";
import { OtelloProvider } from "./context/Store.tsx";
import { ActivityPage } from "./pages/ActivityPage.tsx";
import { AgentsPage } from "./pages/AgentsPage.tsx";
import { LeaseDetailPage } from "./pages/LeaseDetailPage.tsx";
import { LeasesPage } from "./pages/LeasesPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { ProviderPortalPage, ProvidersPage } from "./pages/ProvidersPage.tsx";
import { RequestLeasePage } from "./pages/RequestLeasePage.tsx";
import { ResourceDetailPage } from "./pages/ResourceDetailPage.tsx";
import { ResourcesPage } from "./pages/ResourcesPage.tsx";
import { UsagePage } from "./pages/UsagePage.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <OtelloProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<OverviewPage />} />
            <Route path="resources" element={<ResourcesPage />} />
            <Route path="resources/:id" element={<ResourceDetailPage />} />
            <Route path="leases" element={<LeasesPage />} />
            <Route path="leases/new" element={<RequestLeasePage />} />
            <Route path="leases/:id" element={<LeaseDetailPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="providers" element={<ProvidersPage />} />
            <Route path="providers/:id" element={<ProviderPortalPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="*" element={<p className="font-serif text-5xl">That page is not part of the protocol.</p>} />
          </Route>
        </Routes>
      </OtelloProvider>
    </BrowserRouter>
  );
}
