import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ROLE_HOME } from "@er/shared";
import { SessionProvider, useSession } from "./lib/session";
import { RequireRole } from "./components/RequireRole";
import { Login } from "./pages/Login";
import { Intake } from "./pages/Intake";
import { Patients } from "./pages/Patients";
import { AdminAudit } from "./pages/AdminAudit";

function Home() {
  const { profile } = useSession();
  return <Navigate to={profile ? ROLE_HOME[profile.role] : "/login"} replace />;
}

export function App() {
  return (
    <SessionProvider>
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
