import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { CLINICAL_ROLES, ROLE_HOME, type Role } from "@er/shared";
import { SessionProvider, useSession } from "./lib/session";
import { RequireRole } from "./components/RequireRole";
import { Login } from "./pages/Login";
import { Intake } from "./pages/Intake";
import { Patients } from "./pages/Patients";
import { PatientRecordPage } from "./pages/PatientRecordPage";
import { NewVisitPage } from "./pages/NewVisitPage";
import { AdminAudit } from "./pages/AdminAudit";
import { CampaignsPage } from "./pages/CampaignsPage";
import { QueuePage } from "./pages/QueuePage";
import { StepPage } from "./pages/StepPage";
// Block 4a: administration.
import { AdminHome } from "./pages/AdminHome";
import { AdminMatches } from "./pages/AdminMatches";
import { AdminConflicts } from "./pages/AdminConflicts";
import { AdminStaff } from "./pages/AdminStaff";
import { AdminCampaigns } from "./pages/AdminCampaigns";
// Block 4b: AI agents.
import { AdminAgents } from "./pages/AdminAgents";
import { startSyncEngine } from "./data/sync";
// Block 3a: form photo
import { ScanIdentifyPage } from "./pages/ScanIdentifyPage";
// Block 3b: Excel import
import { ImportPage } from "./pages/ImportPage";
import { ImportBatchPage } from "./pages/ImportBatchPage";

const CLINICAL: Role[] = [...CLINICAL_ROLES];

function Home() {
  const { profile } = useSession();
  return <Navigate to={profile ? ROLE_HOME[profile.role] : "/login"} replace />;
}

/** Runs the outbox/pull engine while someone is signed in. */
function SyncEngine() {
  const { profile } = useSession();
  const id = profile?.id ?? null;
  const role = profile?.role ?? null;
  // Restarts when the person changes, so the engine never runs with the previous person's role.
  useEffect(() => (id && role ? startSyncEngine({ id, role }) : undefined), [id, role]);
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
              <RequireRole roles={["intake", ...CLINICAL]}>
                <Patients />
              </RequireRole>
            }
          />
          <Route
            path="/patients/:id"
            element={
              <RequireRole roles={["intake", ...CLINICAL]}>
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
              <RequireRole roles={["intake", ...CLINICAL, "admin"]}>
                <CampaignsPage />
              </RequireRole>
            }
          />
          <Route
            path="/queue"
            element={
              <RequireRole roles={CLINICAL}>
                <QueuePage />
              </RequireRole>
            }
          />
          <Route
            path="/visits/:folio/step"
            element={
              <RequireRole roles={CLINICAL}>
                <StepPage />
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
          {/* Block 3a: form photo */}
          <Route
            path="/intake/scan"
            element={
              <RequireRole roles={["intake"]}>
                <ScanIdentifyPage />
              </RequireRole>
            }
          />
          {/* Block 3b: Excel import */}
          <Route
            path="/intake/import"
            element={
              <RequireRole roles={["intake"]}>
                <ImportPage />
              </RequireRole>
            }
          />
          <Route
            path="/intake/import/:id"
            element={
              <RequireRole roles={["intake"]}>
                <ImportBatchPage />
              </RequireRole>
            }
          />
          {/* Block 4a: administration (online-only screens, SPEC 6.9). */}
          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <AdminHome />
              </RequireRole>
            }
          />
          <Route
            path="/admin/matches"
            element={
              <RequireRole roles={["admin"]}>
                <AdminMatches />
              </RequireRole>
            }
          />
          <Route
            path="/admin/conflicts"
            element={
              <RequireRole roles={["admin", ...CLINICAL]}>
                <AdminConflicts />
              </RequireRole>
            }
          />
          <Route
            path="/admin/staff"
            element={
              <RequireRole roles={["admin"]}>
                <AdminStaff />
              </RequireRole>
            }
          />
          <Route
            path="/admin/campaigns"
            element={
              <RequireRole roles={["admin"]}>
                <AdminCampaigns />
              </RequireRole>
            }
          />
          <Route
            path="/admin/agents"
            element={
              <RequireRole roles={["admin"]}>
                <AdminAgents />
              </RequireRole>
            }
          />
          <Route path="*" element={<Home />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
