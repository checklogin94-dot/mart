import React, { useState, useEffect, useContext, createContext, useRef, useMemo } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { User, Product, Order, AuthState, UserRole, UserStatus, PixKeyType, DeliveryMethod, ShippingAddress, ChatMessage, DirectMessage } from './types';
import { supabaseService, supabase } from './services/supabase';
import { eyoService, PaymentData } from './services/eyo';
import { Button, Input, Card, Badge, StatusBadge, Modal } from './components/ui';

// --- Auth Context ---
interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    let mounted = true;

    // Timeout de segurança: libera o app após 5s se o Supabase não responder
    const safetyTimeout = setTimeout(() => {
      if (mounted) setState(s => s.isLoading ? { ...s, isLoading: false } : s);
    }, 5000);

    supabaseService.auth.getSession().then(user => {
      if (!mounted) return;
      if (user) {
        setState({ user, isAuthenticated: true, isLoading: false });
      } else {
        setState(s => ({ ...s, isLoading: false }));
      }
      clearTimeout(safetyTimeout);
    }).catch(err => {
      console.error("Auth Error:", err);
      if (mounted) setState(s => ({ ...s, isLoading: false }));
      clearTimeout(safetyTimeout);
    });

    return () => { 
        mounted = false;
        clearTimeout(safetyTimeout);
    };
  }, []);

  const login = async (email: string, password: string) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
        const { data, error } = await supabaseService.auth.signIn(email, password);
        if (data && !error) {
            setState({ user: data.user, isAuthenticated: true, isLoading: false });
        } else {
            setState(s => ({ ...s, isLoading: false }));
            throw new Error(error || 'Login failed');
        }
    } catch (e: any) {
        setState(s => ({ ...s, isLoading: false }));
        throw e;
    }
  };

  const logout = async () => {
    await supabaseService.auth.signOut();
    setState({ user: null, isAuthenticated: false, isLoading: false });
  };
  
  const updateUser = (updatedUser: User) => {
      setState(prev => ({ ...prev, user: updatedUser }));
  };

  const contextValue = useMemo(() => ({
      ...state, login, logout, updateUser
  }), [state, login, logout, updateUser]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Real-time Chat Component ---
const ChatModal: React.FC<{ order: Order; onClose: () => void }> = ({ order, onClose }) => {
    const { user } = useAuth();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const [isClosingOrder, setIsClosingOrder] = useState(false);

    useEffect(() => {
        // Load initial
        supabaseService.db.chat.getMessages(order.id).then(res => {
            if(res.data) setMessages(res.data);
        });

        // Subscribe to real-time updates (INSERT and DELETE)
        const channel = supabase
            .channel(`order_chat:${order.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `order_id=eq.${order.id}` }, (payload) => {
                if (payload.eventType === 'INSERT') {
                    const newMsg: ChatMessage = {
                        id: payload.new.id,
                        orderId: payload.new.order_id,
                        senderId: payload.new.sender_id,
                        content: payload.new.content,
                        createdAt: payload.new.created_at
                    };
                    setMessages(prev => [...prev, newMsg]);
                } else if (payload.eventType === 'DELETE') {
                    setMessages(prev => prev.filter(m => m.id !== payload.old.id));
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [order.id]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!newMessage.trim() || !user) return;
        setSending(true);
        try {
            await supabaseService.db.chat.sendMessage(order.id, user.id, newMessage);
            setNewMessage('');
        } finally {
            setSending(false);
        }
    };

    const handleMarkDelivered = async () => {
        if(!window.confirm("ATENÇÃO: Deseja realmente APAGAR este chat? O histórico será perdido permanentemente.")) return;
        setIsClosingOrder(true);
        await supabaseService.db.orders.markDelivered(order.id);
        setIsClosingOrder(false);
        onClose();
    };

    const isSeller = user?.id === order.sellerId;

    return (
        <Modal isOpen={true} onClose={onClose} title={`Chat: ${order.productTitle}`}>
             <div className="flex flex-col h-[600px]">
                 <div className="bg-dark-800 p-4 rounded-lg border border-gray-700 mb-3 space-y-2 text-sm shadow-lg">
                     <div className="flex justify-between items-start border-b border-gray-700 pb-2">
                         <div>
                             <p className="text-gray-400 text-xs uppercase font-bold">Comprador</p>
                             <p className="text-white font-medium">{order.buyerName || 'Usuário Nexus'}</p>
                         </div>
                         <div className="text-right">
                             <p className="text-gray-400 text-xs uppercase font-bold">Status</p>
                             <p className="text-emerald-400 font-bold">PAGO</p>
                         </div>
                     </div>
                     {isSeller && (
                         <div className="pt-2">
                             <Button variant="danger" fullWidth onClick={handleMarkDelivered} isLoading={isClosingOrder} className="font-bold border border-red-500/50 shadow-red-900/20 flex items-center justify-center gap-2">
                                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                 Apagar Chat & Finalizar
                             </Button>
                             <p className="text-[10px] text-gray-500 text-center mt-1">Isso encerra o pedido e limpa as mensagens.</p>
                         </div>
                     )}
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-black/20 rounded-lg border border-gray-800">
                     {messages.length === 0 && <p className="text-center text-gray-500 text-sm mt-10">Este é o início do chat sobre o pedido.</p>}
                     {messages.map(msg => {
                         const isMe = msg.senderId === user?.id;
                         return (
                             <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                 <div className={`max-w-[80%] p-3 rounded-xl text-sm ${isMe ? 'bg-primary-600 text-white rounded-br-none' : 'bg-dark-700 text-gray-200 rounded-bl-none border border-gray-600'}`}>
                                     {msg.content}
                                     <div className={`text-[10px] mt-1 opacity-60 ${isMe ? 'text-right' : 'text-left'}`}>
                                         {new Date(msg.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                     </div>
                                 </div>
                             </div>
                         );
                     })}
                     <div ref={messagesEndRef} />
                 </div>

                 <form onSubmit={handleSend} className="pt-3 flex gap-2">
                     <input 
                        className="flex-1 bg-dark-900 border border-gray-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                        placeholder="Digite sua mensagem..."
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                     />
                     <Button type="submit" disabled={!newMessage.trim() || sending} className="px-4">
                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                     </Button>
                 </form>
             </div>
        </Modal>
    );
};

// --- Direct Chat Component (No Order Required) ---
const DirectChatModal: React.FC<{ buyer: User; onClose: () => void; onMessageSent?: () => void }> = ({ buyer, onClose, onMessageSent }) => {
    const { user } = useAuth();
    const [messages, setMessages] = useState<DirectMessage[]>([]);
    const [newMessage, setNewMessage] = useState('');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!user) return;
        
        // 1. Load initial messages
        supabaseService.db.directChat.getMessages(user.id, buyer.id).then(res => {
            if(res.data) setMessages(res.data);
        });

        // 2. Subscribe to real-time updates
        const channel = supabase
            .channel(`direct_chat:${user.id}_${buyer.id}`)
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'direct_messages'
            }, (payload) => {
                const newMsg = payload.new;
                
                // Client-side Filter
                const isRelevant = 
                    (newMsg.sender_id === user.id && newMsg.receiver_id === buyer.id) ||
                    (newMsg.sender_id === buyer.id && newMsg.receiver_id === user.id);

                if (isRelevant) {
                    if (newMsg.sender_id !== user.id) {
                         setMessages(prev => [...prev, {
                            id: newMsg.id,
                            senderId: newMsg.sender_id,
                            receiverId: newMsg.receiver_id,
                            content: newMsg.content,
                            createdAt: newMsg.created_at
                        }]);
                    }
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [user, buyer.id]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!newMessage.trim() || !user) return;
        
        const contentToSend = newMessage;
        setNewMessage(''); // Clear input immediately
        setSending(true);

        // Optimistic Update
        const optimisticMsg: DirectMessage = {
            id: Math.random().toString(), 
            senderId: user.id,
            receiverId: buyer.id,
            content: contentToSend,
            createdAt: new Date().toISOString()
        };
        setMessages(prev => [...prev, optimisticMsg]);

        try {
            await supabaseService.db.directChat.sendMessage(user.id, buyer.id, contentToSend);
            if (onMessageSent) onMessageSent();
        } catch (err) {
            console.error(err);
        } finally {
            setSending(false);
        }
    };

    return (
        <Modal isOpen={true} onClose={onClose} title={`Chat com ${buyer.name}`}>
             <div className="flex flex-col h-[600px]">
                 <div className="bg-dark-800 p-4 rounded-lg border border-gray-700 mb-3 space-y-2 text-sm shadow-lg flex items-center gap-3">
                     <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-lg">
                        {buyer.name.charAt(0).toUpperCase()}
                     </div>
                     <div>
                         <p className="text-gray-400 text-xs uppercase font-bold">Contato</p>
                         <p className="text-white font-medium">{buyer.name}</p>
                         <p className="text-gray-500 text-xs">{buyer.email}</p>
                     </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-black/20 rounded-lg border border-gray-800">
                     {messages.length === 0 && <p className="text-center text-gray-500 text-sm mt-10">Inicie uma conversa direta.</p>}
                     {messages.map(msg => {
                         const isMe = msg.senderId === user?.id;
                         return (
                             <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                 <div className={`max-w-[80%] p-3 rounded-xl text-sm ${isMe ? 'bg-primary-600 text-white rounded-br-none' : 'bg-dark-700 text-gray-200 rounded-bl-none border border-gray-600'}`}>
                                     {msg.content}
                                     <div className={`text-[10px] mt-1 opacity-60 ${isMe ? 'text-right' : 'text-left'}`}>
                                         {new Date(msg.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                     </div>
                                 </div>
                             </div>
                         );
                     })}
                     <div ref={messagesEndRef} />
                 </div>

                 <form onSubmit={handleSend} className="pt-3 flex gap-2">
                     <input 
                        className="flex-1 bg-dark-900 border border-gray-600 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-all"
                        placeholder="Digite sua mensagem..."
                        value={newMessage}
                        onChange={e => setNewMessage(e.target.value)}
                     />
                     <Button type="submit" disabled={!newMessage.trim() || sending} className="px-4">
                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                     </Button>
                 </form>
             </div>
        </Modal>
    );
};

// --- MyMessagesModal (New Component for Buyers) ---
const MyMessagesModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { user } = useAuth();
    const [contacts, setContacts] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedContact, setSelectedContact] = useState<User | null>(null);

    useEffect(() => {
        if(!user) return;
        supabaseService.db.directChat.getContacts(user.id).then(({ data }) => {
            if(data) setContacts(data);
            setLoading(false);
        });
    }, [user]);

    return (
        <Modal isOpen={true} onClose={onClose} title="Minhas Conversas">
            {loading ? <div className="text-center p-4">Carregando...</div> : contacts.length === 0 ? <p className="text-gray-400 text-center p-4">Nenhuma conversa encontrada.</p> : (
                <div className="space-y-3">
                    {contacts.map(contact => (
                        <div key={contact.id} className="bg-dark-800 p-3 rounded-lg border border-gray-700 flex justify-between items-center cursor-pointer hover:border-gray-600 transition-colors" onClick={() => setSelectedContact(contact)}>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-white font-bold">
                                    {contact.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h4 className="font-bold text-white text-sm">{contact.name}</h4>
                                    <p className="text-[10px] text-gray-500">Toque para abrir</p>
                                </div>
                            </div>
                            <div className="text-primary-400">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {selectedContact && <DirectChatModal buyer={selectedContact} onClose={() => setSelectedContact(null)} />}
        </Modal>
    );
};

// ... MyOrdersModal remains same ...
const MyOrdersModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { user } = useAuth();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    useEffect(() => {
        if(!user) return;
        supabaseService.db.orders.getForBuyer(user.id).then(({ data }) => {
            if(data) setOrders(data);
            setLoading(false);
        });
    }, [user]);

    return (
        <Modal isOpen={true} onClose={onClose} title="Meus Pedidos">
            {loading ? <div className="text-center p-4">Carregando...</div> : orders.length === 0 ? <p className="text-gray-400 text-center p-4">Você ainda não fez compras.</p> : (
                <div className="space-y-3">
                    {orders.map(order => (
                        <div key={order.id} className="bg-dark-800 p-3 rounded-lg border border-gray-700 flex justify-between items-center cursor-pointer hover:border-gray-600 transition-colors" onClick={() => order.status === 'paid' && setSelectedOrder(order)}>
                            <div>
                                <h4 className="font-bold text-white text-sm">{order.productTitle}</h4>
                                <p className="text-xs text-emerald-400 font-mono">R$ {order.price.toFixed(2)}</p>
                                <p className="text-[10px] text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${order.status === 'delivered' ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-blue-500/30 text-blue-400 bg-blue-500/10'}`}>
                                    {order.status === 'delivered' ? 'Entregue' : 'Pago'}
                                </span>
                                {order.status === 'paid' && (
                                    <div className="flex items-center gap-1 text-primary-400 text-xs font-bold">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                                        Chat
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {selectedOrder && <ChatModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
        </Modal>
    );
};

const FloatingDashboardButton: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  if (!user || user.role === 'buyer') return null;
  const isSeller = user.role === 'premium';
  const colorClass = isSeller ? "bg-primary-600 hover:bg-primary-500 shadow-lg shadow-primary-500/30 border-primary-400" : "bg-red-600 hover:bg-red-500 shadow-red-500/30 border-red-400";
  const targetPath = isSeller ? '/seller-dashboard' : '/admin';
  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <button onClick={() => navigate(targetPath)} className={`${colorClass} text-white font-bold p-4 rounded-full border flex items-center justify-center transition-transform hover:scale-110 active:scale-95`} title="Painel">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
      </button>
    </div>
  );
};

const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showMyOrders, setShowMyOrders] = useState(false);
  const [showMessages, setShowMessages] = useState(false);

  return (
    <>
    <nav className="sticky top-0 z-40 w-full bg-dark-900/80 backdrop-blur-md border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
            <div className="flex items-center cursor-pointer" onClick={() => navigate('/feed')}>
                <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary-400 to-purple-500">NEXUS</span>
            </div>
            
            <div className="hidden md:flex items-center space-x-4">
                <Button variant="ghost" onClick={() => navigate('/feed')}>Feed</Button>
                {user?.role === 'admin' && <Button variant="ghost" onClick={() => navigate('/admin')}>Admin</Button>}
                {(user?.role === 'premium' || user?.role === 'admin') && (
                    <>
                        <Button variant="ghost" onClick={() => navigate('/seller-dashboard')}>Painel Vendedor</Button>
                        <Button variant="ghost" onClick={() => navigate('/create-ad')}>Anunciar</Button>
                        <button onClick={() => navigate('/seller-dashboard')} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors bg-white/5 rounded-lg border border-transparent hover:border-gray-700">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                            Mensagens
                        </button>
                    </>
                )}
                <div className="h-6 w-px bg-gray-800 mx-2"></div>
                 <Button variant="ghost" onClick={() => setShowMyOrders(true)}>Meus Pedidos</Button>
                 <Button variant="ghost" onClick={() => setShowMessages(true)}>Mensagens</Button>
                <div className="relative group">
                    <button className="flex items-center space-x-2 text-sm text-gray-300 hover:text-white transition-colors">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-white font-bold">{user?.name.charAt(0).toUpperCase()}</div>
                        <span>{user?.name}</span>
                    </button>
                    <div className="absolute right-0 mt-2 w-48 bg-dark-800 border border-gray-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all transform origin-top-right">
                        <div className="py-1">
                            <button onClick={() => navigate('/profile')} className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/5 hover:text-white">Perfil</button>
                            <button onClick={logout} className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/5 hover:text-red-300">Sair</button>
                        </div>
                    </div>
                </div>
            </div>
             <div className="md:hidden flex items-center">
                 <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="text-gray-300 hover:text-white">
                     <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                 </button>
             </div>
        </div>
      </div>
      {isMenuOpen && (
          <div className="md:hidden bg-dark-800 border-b border-gray-700">
              <div className="px-2 pt-2 pb-3 space-y-1">
                  <Button variant="ghost" fullWidth onClick={() => { navigate('/feed'); setIsMenuOpen(false); }} className="justify-start">Feed</Button>
                  <Button variant="ghost" fullWidth onClick={() => { setShowMyOrders(true); setIsMenuOpen(false); }} className="justify-start">Meus Pedidos</Button>
                  <Button variant="ghost" fullWidth onClick={() => { setShowMessages(true); setIsMenuOpen(false); }} className="justify-start">Minhas Mensagens</Button>
                  {(user?.role === 'premium' || user?.role === 'admin') && (
                       <>
                       <Button variant="ghost" fullWidth onClick={() => { navigate('/seller-dashboard'); setIsMenuOpen(false); }} className="justify-start">Mensagens / Vendas</Button>
                       <Button variant="ghost" fullWidth onClick={() => { navigate('/create-ad'); setIsMenuOpen(false); }} className="justify-start">Anunciar</Button>
                       </>
                  )}
                  {user?.role === 'admin' && <Button variant="ghost" fullWidth onClick={() => { navigate('/admin'); setIsMenuOpen(false); }} className="justify-start">Admin</Button>}
                  <div className="border-t border-gray-700 my-2 pt-2">
                       <Button variant="ghost" fullWidth onClick={() => { navigate('/profile'); setIsMenuOpen(false); }} className="justify-start">Perfil</Button>
                       <Button variant="ghost" fullWidth onClick={logout} className="justify-start text-red-400">Sair</Button>
                  </div>
              </div>
          </div>
      )}
    </nav>
    {showMyOrders && <MyOrdersModal onClose={() => setShowMyOrders(false)} />}
    {showMessages && <MyMessagesModal onClose={() => setShowMessages(false)} />}
    </>
  );
};

// --- PAGES ---

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/feed');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 px-4">
      <Card className="w-full max-w-md p-8 bg-dark-800/80 border-gray-700">
        <h2 className="text-3xl font-bold text-white text-center mb-2">NEXUS</h2>
        <p className="text-gray-400 text-center mb-8">Acesso ao Marketplace</p>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input 
            label="Email" 
            type="email" 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            required 
            placeholder="seu@email.com"
          />
          <Input 
            label="Senha" 
            type="password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            required 
            placeholder="••••••••"
          />
          {error && <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
          <Button type="submit" fullWidth isLoading={loading}>Entrar</Button>
        </form>
      </Card>
    </div>
  );
};

const Feed: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    supabaseService.db.products.getAll().then(res => {
      if (res.data) setProducts(res.data);
      setLoading(false);
    });
  }, []);

  const filtered = products.filter(p => 
    p.title.toLowerCase().includes(search.toLowerCase()) || 
    p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-dark-900 pb-20">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Input 
            placeholder="Buscar produtos..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            className="bg-dark-800 border-gray-700"
          />
        </div>
        
        {loading ? (
           <div className="text-center text-gray-500 mt-10">Carregando feed...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filtered.map(product => (
              <div 
                key={product.id} 
                onClick={() => navigate(`/product/${product.id}`)}
                className="group bg-dark-800 rounded-xl overflow-hidden border border-gray-800 hover:border-primary-500/50 transition-all cursor-pointer hover:shadow-lg hover:shadow-primary-900/10"
              >
                <div className="aspect-square w-full overflow-hidden bg-gray-900 relative">
                  <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md text-xs text-white font-mono">
                    {product.quantity > 0 ? `${product.quantity} un.` : 'Esgotado'}
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                     <h3 className="font-bold text-white text-lg line-clamp-1">{product.title}</h3>
                  </div>
                  <p className="text-emerald-400 font-bold text-xl mb-4">R$ {product.price.toFixed(2)}</p>
                  <div className="flex items-center gap-2 text-gray-500 text-xs">
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-gray-300">
                        {product.sellerAvatar ? <img src={product.sellerAvatar} className="w-full h-full rounded-full" /> : product.sellerName.charAt(0)}
                    </div>
                    <span>{product.sellerName}</span>
                    <span className="mx-1">•</span>
                    <span>{product.city}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const ProductDetails: React.FC = () => {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const [product, setProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);
    const [showPayment, setShowPayment] = useState(false);
    const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [directChatUser, setDirectChatUser] = useState<User | null>(null);

    useEffect(() => {
        if(id) {
            supabaseService.db.products.getAll().then(res => {
                const found = res.data?.find(p => p.id === id);
                setProduct(found || null);
                setLoading(false);
            });
        }
    }, [id]);

    const handleBuy = async () => {
        if (!product || !user) return;
        try {
            setVerifying(true);
            const res = await eyoService.createPayment(product.price, `Order: ${product.title}`);
            if (res.success && res.data) {
                setPaymentData(res.data);
                setShowPayment(true);
            } else {
                alert("Erro ao gerar Pix: " + res.error);
            }
        } catch(e) {
            alert("Erro ao processar");
        } finally {
            setVerifying(false);
        }
    };

    const confirmPayment = async () => {
        if (!paymentData || !product || !user) return;
        setVerifying(true);
        try {
            const statusRes = await eyoService.getPaymentStatus(paymentData.id);
            // In real scenario check for COMPLETED. 
            // For now, if we get data back successfully, we simulate completion or check status
            if (statusRes.success && (statusRes.data?.status === 'COMPLETED' || statusRes.data?.status === 'ACTIVE')) { 
                 // Create Order
                 const { data: order, error } = await supabaseService.db.orders.create({
                     buyerId: user.id,
                     sellerId: product.sellerId,
                     productId: product.id,
                     productTitle: product.title,
                     price: product.price,
                     status: 'paid'
                 });

                 if (error || !order) throw new Error(error || 'Failed to create order');

                 // Update Stock
                 await supabaseService.db.products.updateStock(product.id, product.quantity - 1);

                 // Create Withdrawal (Transfer to Seller)
                 await eyoService.createWithdraw(product.price, product.pixKey, product.pixKeyType);

                 alert("Pagamento confirmado! Pedido criado.");
                 navigate('/feed');
            } else {
                alert("Pagamento ainda não confirmado. Status: " + statusRes.data?.status);
            }
        } catch (e:any) {
            alert("Erro ao verificar: " + e.message);
        } finally {
            setVerifying(false);
        }
    };
    
    const openDirectChat = () => {
        if (product) {
            setDirectChatUser({
                id: product.sellerId,
                name: product.sellerName,
                email: 'Contato via anúncio',
                role: 'premium',
                status: 'active',
                createdAt: new Date().toISOString()
            } as User);
        }
    };

    if (loading) return <div className="text-center text-white mt-20">Carregando...</div>;
    if (!product) return <div className="text-center text-white mt-20">Produto não encontrado.</div>;

    return (
        <div className="min-h-screen bg-dark-900">
            <Navbar />
            <div className="max-w-4xl mx-auto px-4 py-10">
                <Card className="flex flex-col md:flex-row overflow-hidden">
                    <div className="md:w-1/2 bg-gray-900 h-96 md:h-auto">
                        <img src={product.imageUrl} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-8 md:w-1/2 flex flex-col">
                        <h1 className="text-2xl font-bold text-white mb-2">{product.title}</h1>
                        <p className="text-emerald-400 text-3xl font-bold mb-4">R$ {product.price.toFixed(2)}</p>
                        
                        <div className="flex items-center gap-3 mb-6 p-3 bg-dark-900/50 rounded-lg border border-gray-700">
                            <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-gray-300 font-bold">
                                {product.sellerAvatar ? <img src={product.sellerAvatar} className="w-full h-full rounded-full"/> : product.sellerName.charAt(0)}
                            </div>
                            <div>
                                <p className="text-white font-medium text-sm">{product.sellerName}</p>
                                <p className="text-gray-500 text-xs">{product.city}</p>
                            </div>
                            <Button variant="ghost" className="ml-auto text-xs" onClick={openDirectChat}>Chat</Button>
                        </div>

                        <div className="prose prose-invert text-gray-400 text-sm mb-8 flex-1">
                            {product.description}
                        </div>

                        {user?.id !== product.sellerId && (
                            <Button fullWidth onClick={handleBuy} disabled={product.quantity < 1}>
                                {product.quantity > 0 ? 'Comprar Agora' : 'Esgotado'}
                            </Button>
                        )}
                    </div>
                </Card>
            </div>

            {/* Payment Modal */}
            {showPayment && paymentData && (
                <Modal isOpen={true} onClose={() => setShowPayment(false)} title="Pagamento Pix">
                    <div className="text-center space-y-4">
                        <p className="text-gray-300">Escaneie o QR Code para pagar:</p>
                        <div className="bg-white p-2 inline-block rounded-lg">
                            <img src={paymentData.qrcodeUrl} alt="QR Code" className="w-48 h-48" />
                        </div>
                        <div className="bg-dark-900 p-3 rounded text-xs text-gray-400 break-all font-mono">
                            {paymentData.copyPaste || 'Código copia e cola indisponível'}
                        </div>
                        <Button fullWidth onClick={confirmPayment} isLoading={verifying} className="bg-emerald-600 hover:bg-emerald-500">
                            Já Paguei / Verificar
                        </Button>
                    </div>
                </Modal>
            )}
            
            {directChatUser && <DirectChatModal buyer={directChatUser} onClose={() => setDirectChatUser(null)} />}
        </div>
    );
};

const CreateAd: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: '', description: '', price: '', city: '', quantity: '1', pixKey: '', pixKeyType: 'RANDOM' as PixKeyType
    });
    const [image, setImage] = useState<File | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !image) return;
        setLoading(true);
        try {
            // 1. Upload Image
            const uploadRes = await supabaseService.storage.uploadImage(image, user.id);
            if (!uploadRes) throw new Error("Upload falhou");

            // 2. Create Product
            await supabaseService.db.products.create({
                title: formData.title,
                description: formData.description,
                price: parseFloat(formData.price),
                city: formData.city,
                quantity: parseInt(formData.quantity),
                pixKey: formData.pixKey,
                pixKeyType: formData.pixKeyType,
                imageUrl: uploadRes.url,
                imagePath: uploadRes.path,
                deliveryMethod: 'shipping' // Default for now
            }, user);

            navigate('/feed');
        } catch (e: any) {
            alert(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-dark-900 pb-20">
            <Navbar />
            <div className="max-w-2xl mx-auto px-4 py-8">
                <Card className="p-6">
                    <h2 className="text-xl font-bold text-white mb-6">Novo Anúncio</h2>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <Input label="Título" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} required />
                        <div className="grid grid-cols-2 gap-4">
                            <Input label="Preço (R$)" type="number" step="0.01" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required />
                            <Input label="Quantidade" type="number" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} required />
                        </div>
                        <Input label="Cidade/Estado" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} required />
                        <div>
                            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Descrição</label>
                            <textarea 
                                className="w-full bg-dark-800 border border-gray-700 rounded-lg p-3 text-gray-200 focus:border-primary-500 focus:outline-none"
                                rows={4}
                                value={formData.description}
                                onChange={e => setFormData({...formData, description: e.target.value})}
                                required
                            />
                        </div>
                        <div className="border-t border-gray-700 pt-4">
                            <h3 className="text-sm font-bold text-gray-300 mb-3">Dados para Recebimento (Pix)</h3>
                            <div className="grid grid-cols-3 gap-2 mb-2">
                                {(['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'] as PixKeyType[]).map(t => (
                                    <button 
                                        type="button"
                                        key={t}
                                        onClick={() => setFormData({...formData, pixKeyType: t})}
                                        className={`text-xs py-1 rounded border ${formData.pixKeyType === t ? 'bg-primary-500/20 border-primary-500 text-primary-400' : 'border-gray-700 text-gray-400'}`}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                            <Input label="Chave Pix" value={formData.pixKey} onChange={e => setFormData({...formData, pixKey: e.target.value})} required />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Foto do Produto</label>
                            <input type="file" onChange={e => setImage(e.target.files?.[0] || null)} accept="image/*" className="text-gray-400 text-sm" required />
                        </div>
                        <Button type="submit" fullWidth isLoading={loading} className="mt-4">Publicar Anúncio</Button>
                    </form>
                </Card>
            </div>
        </div>
    );
};

const SellerDashboard: React.FC = () => {
    const { user } = useAuth();
    const [tab, setTab] = useState<'products' | 'orders'>('orders');
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    useEffect(() => {
        if (!user) return;
        supabaseService.db.products.getAll().then(res => {
            if(res.data) setProducts(res.data.filter(p => p.sellerId === user.id));
        });
        supabaseService.db.orders.getForSeller(user.id).then(res => {
            if(res.data) setOrders(res.data);
        });
    }, [user]);

    const handleDelete = async (id: string) => {
        if(window.confirm('Excluir este anúncio?')) {
            await supabaseService.db.products.delete(id);
            setProducts(products.filter(p => p.id !== id));
        }
    };

    return (
        <div className="min-h-screen bg-dark-900 pb-20">
            <Navbar />
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="flex gap-4 mb-6 border-b border-gray-800 pb-2">
                    <button onClick={() => setTab('orders')} className={`pb-2 ${tab === 'orders' ? 'text-primary-400 border-b-2 border-primary-400 font-bold' : 'text-gray-400'}`}>Vendas ({orders.length})</button>
                    <button onClick={() => setTab('products')} className={`pb-2 ${tab === 'products' ? 'text-primary-400 border-b-2 border-primary-400 font-bold' : 'text-gray-400'}`}>Meus Anúncios ({products.length})</button>
                </div>

                {tab === 'products' ? (
                    <div className="space-y-4">
                        {products.map(p => (
                            <div key={p.id} className="bg-dark-800 p-4 rounded-lg flex items-center justify-between border border-gray-700">
                                <div className="flex items-center gap-4">
                                    <img src={p.imageUrl} className="w-16 h-16 rounded object-cover" />
                                    <div>
                                        <h4 className="font-bold text-white">{p.title}</h4>
                                        <p className="text-sm text-gray-400">R$ {p.price} • Estoque: {p.quantity}</p>
                                    </div>
                                </div>
                                <Button variant="danger" onClick={() => handleDelete(p.id)} className="px-3 py-1 text-xs">Excluir</Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {orders.map(o => (
                            <div key={o.id} className="bg-dark-800 p-4 rounded-lg flex items-center justify-between border border-gray-700 cursor-pointer hover:border-primary-500/30" onClick={() => setSelectedOrder(o)}>
                                <div>
                                    <h4 className="font-bold text-white text-sm">Pedido #{o.id.substring(0,8)}</h4>
                                    <p className="text-gray-400 text-xs">Produto: {o.productTitle}</p>
                                    <p className="text-emerald-400 font-mono text-sm">R$ {o.price.toFixed(2)} - PAGO</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-gray-500 text-xs">{new Date(o.createdAt).toLocaleDateString()}</p>
                                    <span className="text-primary-400 text-xs font-bold flex items-center gap-1 justify-end mt-1">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                                        Chat com Cliente
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            {selectedOrder && <ChatModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
        </div>
    );
};

const AdminDashboard: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [showAddUser, setShowAddUser] = useState(false);
    const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'buyer' as UserRole });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = () => {
        supabaseService.db.users.getAll().then(res => res.data && setUsers(res.data));
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        await supabaseService.db.users.create(newUser);
        setShowAddUser(false);
        loadUsers();
    };

    const toggleStatus = async (user: User) => {
        const newStatus = user.status === 'active' ? 'suspended' : 'active';
        await supabaseService.db.users.update(user.id, { status: newStatus });
        loadUsers();
    };

    return (
        <div className="min-h-screen bg-dark-900 pb-20">
            <Navbar />
            <div className="max-w-6xl mx-auto px-4 py-8">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-white">Administração</h1>
                    <Button onClick={() => setShowAddUser(true)}>+ Novo Usuário</Button>
                </div>
                
                <div className="bg-dark-800 rounded-xl overflow-hidden border border-gray-700">
                    <table className="w-full text-left text-sm text-gray-400">
                        <thead className="bg-dark-900 text-gray-200 uppercase font-bold text-xs">
                            <tr>
                                <th className="p-4">Usuário</th>
                                <th className="p-4">Role</th>
                                <th className="p-4">Status</th>
                                <th className="p-4">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-white/5">
                                    <td className="p-4">
                                        <div className="font-bold text-white">{u.name}</div>
                                        <div className="text-xs">{u.email}</div>
                                    </td>
                                    <td className="p-4"><Badge role={u.role} /></td>
                                    <td className="p-4"><StatusBadge status={u.status} /></td>
                                    <td className="p-4">
                                        <button onClick={() => toggleStatus(u)} className="text-xs text-primary-400 hover:underline">
                                            {u.status === 'active' ? 'Suspender' : 'Ativar'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showAddUser && (
                <Modal isOpen={true} onClose={() => setShowAddUser(false)} title="Criar Usuário">
                    <form onSubmit={handleCreateUser} className="space-y-4">
                        <Input label="Nome" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} required />
                        <Input label="Email" type="email" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} required />
                        <Input label="Senha" type="password" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} required />
                        <div>
                            <label className="block text-xs font-medium text-gray-400 uppercase mb-1">Tipo de Conta</label>
                            <select 
                                className="w-full bg-dark-800 border border-gray-700 rounded-lg p-2 text-white"
                                value={newUser.role}
                                onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                            >
                                <option value="buyer">Comprador</option>
                                <option value="premium">Premium (Vendedor)</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </div>
                        <Button type="submit" fullWidth>Criar Conta</Button>
                    </form>
                </Modal>
            )}
        </div>
    );
};

const Profile: React.FC = () => {
    const { user } = useAuth();
    if (!user) return null;

    return (
        <div className="min-h-screen bg-dark-900 pb-20">
            <Navbar />
            <div className="max-w-lg mx-auto px-4 py-10">
                <Card className="p-8 text-center">
                    <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-primary-600 to-purple-600 flex items-center justify-center text-3xl font-bold text-white mb-4 shadow-xl shadow-primary-900/20">
                        {user.name.charAt(0).toUpperCase()}
                    </div>
                    <h2 className="text-2xl font-bold text-white">{user.name}</h2>
                    <p className="text-gray-400 mb-4">{user.email}</p>
                    <div className="flex justify-center gap-2 mb-8">
                        <Badge role={user.role} />
                        <StatusBadge status={user.status} />
                    </div>
                    
                    <div className="text-left space-y-4 border-t border-gray-700 pt-6">
                        <h3 className="text-sm font-bold text-gray-300 uppercase">Detalhes da Conta</h3>
                        <div className="bg-dark-900 p-4 rounded-lg space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">ID</span>
                                <span className="text-gray-300 font-mono text-xs">{user.id}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Membro desde</span>
                                <span className="text-gray-300">{new Date(user.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};

// --- APP ROOT ---

const App: React.FC = () => {
    const ProtectedRoute = ({ children, allowedRoles }: { children: JSX.Element, allowedRoles: UserRole[] }) => {
        const { user, isAuthenticated, isLoading } = useAuth();
        if (isLoading) return <div className="min-h-screen bg-dark-900 flex items-center justify-center text-white">Carregando Nexus...</div>;
        if (!isAuthenticated || !user) return <Navigate to="/login" />;
        if (!allowedRoles.includes(user.role)) return <Navigate to="/feed" />;
        return children;
    };

    return (
        <AuthProvider>
            <HashRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    
                    <Route path="/" element={<Navigate to="/feed" />} />
                    
                    <Route path="/feed" element={
                        <ProtectedRoute allowedRoles={['admin', 'premium', 'buyer']}>
                            <Feed />
                        </ProtectedRoute>
                    } />
                    
                    <Route path="/product/:id" element={
                        <ProtectedRoute allowedRoles={['admin', 'premium', 'buyer']}>
                            <ProductDetails />
                        </ProtectedRoute>
                    } />
                    
                    <Route path="/create-ad" element={
                        <ProtectedRoute allowedRoles={['admin', 'premium']}>
                            <CreateAd />
                        </ProtectedRoute>
                    } />
                    
                    <Route path="/seller-dashboard" element={
                        <ProtectedRoute allowedRoles={['admin', 'premium']}>
                            <SellerDashboard />
                        </ProtectedRoute>
                    } />
                    
                    <Route path="/admin" element={
                        <ProtectedRoute allowedRoles={['admin']}>
                            <AdminDashboard />
                        </ProtectedRoute>
                    } />

                    <Route path="/profile" element={
                        <ProtectedRoute allowedRoles={['admin', 'premium', 'buyer']}>
                            <Profile />
                        </ProtectedRoute>
                    } />
                </Routes>
                <FloatingDashboardButton />
            </HashRouter>
        </AuthProvider>
    );
};

export default App;