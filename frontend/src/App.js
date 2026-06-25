import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Transactions from "@/pages/Transactions";
import Installments from "@/pages/Installments";
import Receivables from "@/pages/Receivables";
import Budget from "@/pages/Budget";
import SharedExpenses from "@/pages/SharedExpenses";
import Groups from "@/pages/Groups";
import Settlements from "@/pages/Settlements";
import Reports from "@/pages/Reports";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import Notifications from "@/pages/Notifications";
import Goals from "@/pages/Goals";
import Recurrences from "@/pages/Recurrences";
import Wallets from "@/pages/Wallets";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-[#6B7068]">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function App() {
  useEffect(() => { document.title = "Controle Financeiro"; }, []);
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/cadastro" element={<PublicOnly><Register /></PublicOnly>} />
          <Route path="/" element={<Protected><Layout /></Protected>}>
            <Route index element={<Dashboard />} />
            <Route path="lancamentos" element={<Transactions />} />
            <Route path="parcelamentos" element={<Installments />} />
            <Route path="contas-a-receber" element={<Receivables />} />
            <Route path="orcamento" element={<Budget />} />
            <Route path="despesas-compartilhadas" element={<SharedExpenses />} />
            <Route path="grupos" element={<Groups />} />
            <Route path="acertos" element={<Settlements />} />
            <Route path="relatorios" element={<Reports />} />
            <Route path="perfil" element={<Profile />} />
            <Route path="configuracoes" element={<Settings />} />
            <Route path="notificacoes" element={<Notifications />} />
            <Route path="metas" element={<Goals />} />
            <Route path="recorrencias" element={<Recurrences />} />
            <Route path="carteiras" element={<Wallets />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
