import { lazy, Suspense, useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import InstallPrompt from "@/components/InstallPrompt";
import PWAUpdatePrompt from "@/components/PWAUpdatePrompt";
import { translate as tr } from "@/i18n";

const Login = lazy(() => import("@/pages/Login"));
const Register = lazy(() => import("@/pages/Register"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const Layout = lazy(() => import("@/components/Layout"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Transactions = lazy(() => import("@/pages/Transactions"));
const Installments = lazy(() => import("@/pages/Installments"));
const Receivables = lazy(() => import("@/pages/Receivables"));
const Budget = lazy(() => import("@/pages/Budget"));
const SharedExpenses = lazy(() => import("@/pages/SharedExpenses"));
const Groups = lazy(() => import("@/pages/Groups"));
const Settlements = lazy(() => import("@/pages/Settlements"));
const Reports = lazy(() => import("@/pages/Reports"));
const Profile = lazy(() => import("@/pages/Profile"));
const Settings = lazy(() => import("@/pages/Settings"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const Goals = lazy(() => import("@/pages/Goals"));
const Recurrences = lazy(() => import("@/pages/Recurrences"));
const Wallets = lazy(() => import("@/pages/Wallets"));
const AdminUsers = lazy(() => import("@/pages/AdminUsers"));
const People = lazy(() => import("@/pages/People"));
const FinancialStatement = lazy(() => import("@/pages/FinancialStatement"));
const ProjectedCashFlow = lazy(() => import("@/pages/ProjectedCashFlow"));
const FinancialCalendar = lazy(() => import("@/pages/FinancialCalendar"));
const FinancialHealth = lazy(() => import("@/pages/FinancialHealth"));

function RouteLoading() {
  return (
    <div className="p-8 text-[#6B7068]" role="status" aria-live="polite">
      {tr("Carregando...")}
    </div>
  );
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-[#6B7068]">{tr("Carregando...")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-[#6B7068]">{tr("Carregando...")}</div>;
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return children;
}

function App() {
  useEffect(() => { document.title = tr("Crelith Finance — Controle Financeiro"); }, []);
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <InstallPrompt />
        <PWAUpdatePrompt />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/cadastro" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/redefinir-senha" element={<ResetPassword />} />
            <Route path="/" element={<Protected><Layout /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="lancamentos" element={<Transactions />} />
              <Route path="parcelamentos" element={<Installments />} />
              <Route path="contas-a-receber" element={<Receivables />} />
              <Route path="orcamento" element={<Budget />} />
              <Route path="fluxo-de-caixa" element={<ProjectedCashFlow />} />
              <Route path="calendario-financeiro" element={<FinancialCalendar />} />
              <Route path="saude-financeira" element={<FinancialHealth />} />
              <Route path="despesas-compartilhadas" element={<SharedExpenses />} />
              <Route path="pessoas" element={<People />} />
              <Route path="grupos" element={<Groups />} />
              <Route path="acertos" element={<Settlements />} />
              <Route path="relatorios" element={<Reports />} />
              <Route path="perfil" element={<Profile />} />
              <Route path="configuracoes" element={<Settings />} />
              <Route path="notificacoes" element={<Notifications />} />
              <Route path="metas" element={<Goals />} />
              <Route path="recorrencias" element={<Recurrences />} />
              <Route path="carteiras" element={<Wallets />} />
              <Route path="extrato-financeiro" element={<FinancialStatement />} />
              <Route path="admin/usuarios" element={<AdminOnly><AdminUsers /></AdminOnly>} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
