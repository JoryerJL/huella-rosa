import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ROLE_HOME } from "@er/shared";
import { SessionProvider, useSession } from "./lib/session";
import { RequireRole } from "./components/RequireRole";
import { Login } from "./pages/Login";
import { Intake } from "./pages/Intake";
import { Patients } from "./pages/Patients";
import { PatientRecordPage } from "./pages/PatientRecordPage";
import { NewVisitPage } from "./pages/NewVisitPage";
import { AdminAudit } from "./pages/AdminAudit";
import { CampaignsPage } from "./pages/CampaignsPage";
import { startSyncEngine } from "./data/sync";

function Home() {
  const { profile } = useSession();
  return <Navigate to={profile ? ROLE_HOME[profile.role] : "/login"} replace />;
}

/** Runs the outbox/pull engine while someone is signed in. */
function SyncEngine() {
  const { profile } = useSession();
  const signedIn = profile !== null;
  useEffect(() => (signedIn ? startSyncEngine() : undefined), [signedIn]);
  return null;
}

export function App() {
  return (
    <SessionProvider>
      <SyncEngine />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/intake"
            element={
              <RequireRole roles={["intake"]}>
                <Intake />
              </RequireRole>
            }
          />
          <Route
            path="/patients"
            element={
              <RequireRole roles={["intake", "clinician"]}>
                <Patients />
              </RequireRole>
            }
          />
          <Route
            path="/patients/:id"
            element={
              <RequireRole roles={["intake", "clinician"]}>
                <PatientRecordPage />
              </RequireRole>
            }
          />
          <Route
            path="/patients/:id/visit"
            element={
              <RequireRole roles={["intake"]}>
                <NewVisitPage />
              </RequireRole>
            }
          />
          <Route
            path="/campaigns"
            element={
              <RequireRole roles={["intake", "admin"]}>
                <CampaignsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <RequireRole roles={["admin"]}>
                <AdminAudit />
              </RequireRole>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
