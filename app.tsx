
import React, { useState, useEffect } from 'react';
import { Ticket, TicketStatus, View, RaffleConfig, Seller } from './types';
import { RAFFLE_CONFIG as DEFAULT_CONFIG, Icons } from './constants';
import Home from './components/Home';
import AdminPanel from './components/AdminPanel';
import Sorteador from './components/Sorteador';
import SellerDashboard from './components/SellerDashboard';
import { supabase } from './supabase';
import { SOUNDS } from './constants';

const ADMIN_PIN = "11863"; // Master PIN

const App: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [config, setConfig] = useState<RaffleConfig>(DEFAULT_CONFIG);
  const [currentView, setCurrentView] = useState<View>('HOME');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // Auth State
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [currentSeller, setCurrentSeller] = useState<Seller | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [pendingView, setPendingView] = useState<View | null>(null);

  // Referral State
  const [referralSellerId, setReferralSellerId] = useState<string | null>(null);

  const [isNumbersModalOpen, setIsNumbersModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [logoClicks, setLogoClicks] = useState(0);
  const [soundsEnabled, setSoundsEnabled] = useState(() => {
    return localStorage.getItem('casino_sounds_enabled') === 'true';
  });
  const [lastTicketCount, setLastTicketCount] = useState(-1);
  const [engagementMessage, setEngagementMessage] = useState<string | null>(null);

  const requestNotificationPermission = () => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  };

  const playSound = (url: string) => {
    if (!soundsEnabled) return;
    const audio = new Audio(url);
    audio.play().catch(e => console.error("Error playing sound:", e));
  };

  useEffect(() => {
    localStorage.setItem('casino_sounds_enabled', soundsEnabled.toString());
    if (soundsEnabled) requestNotificationPermission();
  }, [soundsEnabled]);

  // Check URL PARAMS for Referral
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refId = params.get('ref');
    if (refId) {
      console.log("Referral ID detected:", refId);
      setReferralSellerId(refId);
      localStorage.setItem('referral_seller_id', refId);
    } else {
      const savedRef = localStorage.getItem('referral_seller_id');
      if (savedRef) setReferralSellerId(savedRef);
    }
  }, []);

  // Engagement Messages (Zaz! Wow!)
  useEffect(() => {
    const messages = [
      "¡WOW! 🎰 Alguien acaba de apartar sus números.",
      "¡ZAZ! 💎 ¡Esto puede ser tuyo!",
      "🔥 ¡Participa ya antes de que se agoten!",
      "✨ ¡El premio mayor te está esperando!",
      "🎰 ¡Alguien más está revisando el tablero!",
      "💎 ¡No dejes pasar tu oportunidad!",
      "¡BRRR! 💸 El contador sigue bajando..."
    ];

    const interval = setInterval(() => {
      if (currentView === 'HOME') {
        setEngagementMessage(messages[Math.floor(Math.random() * messages.length)]);
        setTimeout(() => setEngagementMessage(null), 4000);
      }
    }, 12000);

    return () => clearInterval(interval);
  }, [currentView]);

  // Monitor for new tickets to notify admin
  useEffect(() => {
    if (!isLoading && isAdminAuthenticated) {
      const relevantTickets = tickets.filter(t => t.status === TicketStatus.APARTADO || t.status === TicketStatus.REVISANDO);

      if (lastTicketCount === -1) {
        setLastTicketCount(relevantTickets.length);
        return;
      }

      if (relevantTickets.length > lastTicketCount) {
        playSound(SOUNDS.NOTIFICATION);

        // Browser Notification
        if ("Notification" in window && Notification.permission === "granted" && soundsEnabled) {
          const n = new Notification("🎰 Casino Premium", {
            body: "¡Hay nuevos números por revisar!",
            icon: "https://i.imgur.com/AYWdNYJ.jpg",
            tag: 'new-order'
          });
          n.onclick = (e) => {
            e.preventDefault();
            window.focus();
            handleNavigate('ADMIN');
          };
        }
      }
      setLastTicketCount(relevantTickets.length);
    } else if (!isAdminAuthenticated) {
      setLastTicketCount(-1);
    }
  }, [tickets, isAdminAuthenticated, isLoading, lastTicketCount, soundsEnabled]);

  // 1. Initial Data Load
  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);

      // Fetch Config
      const { data: configData } = await supabase
        .from('raffle_config')
        .select('data')
        .eq('id', 1)
        .single();

      if (configData) {
        setConfig(configData.data);
      }

      // Fetch Sellers (if table exists, otherwise ignore error for now)
      try {
        const { data: sellersData, error: sellersError } = await supabase
          .from('sellers')
          .select('*');

        if (sellersData) {
          setSellers(sellersData);
        } else if (sellersError) {
          console.warn("Could not fetch sellers (Table might not exist yet):", sellersError.message);
        }
      } catch (err) {
        console.warn("Skipping sellers fetch");
      }

      // Fetch Tickets
      const { data: ticketsData } = await supabase
        .from('tickets')
        .select('*')
        .order('id', { ascending: true });

      if (ticketsData && ticketsData.length > 0) {
        setTickets(ticketsData);
      } else {
        // If DB is empty, initialize with default numbers
        const total = configData?.data?.totalNumbers || DEFAULT_CONFIG.totalNumbers;
        const padLen = total > 100 ? 3 : 2;
        const initialTickets: Ticket[] = Array.from({ length: total }, (_, i) => ({
          id: i.toString().padStart(padLen, '0'),
          status: TicketStatus.AVAILABLE
        }));

        // Populate DB for first time
        await supabase.from('tickets').insert(initialTickets);
        setTickets(initialTickets);
      }

      setIsLoading(false);
    };

    fetchInitialData();

    // 2. Realtime Subscriptions
    const ticketsChannel = supabase
      .channel('public:tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, payload => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const updatedTicket = payload.new as Ticket;
          setTickets(prev => {
            const index = prev.findIndex(t => t.id === updatedTicket.id);
            if (index === -1) return [...prev, updatedTicket].sort((a, b) => a.id.localeCompare(b.id));
            const newTickets = [...prev];
            newTickets[index] = updatedTicket;
            return newTickets;
          });
        } else if (payload.eventType === 'DELETE') {
          setTickets(prev => prev.filter(t => t.id !== payload.old.id));
        }
      })
      .subscribe();

    // Sellers Channel 
    const sellersChannel = supabase
      .channel('public:sellers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sellers' }, payload => {
        if (payload.eventType === 'INSERT') {
          setSellers(prev => [...prev, payload.new as Seller]);
        } else if (payload.eventType === 'DELETE') {
          setSellers(prev => prev.filter(s => s.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          setSellers(prev => prev.map(s => s.id === payload.new.id ? payload.new as Seller : s));
        }
      })
      .subscribe();

    const configChannel = supabase
      .channel('public:raffle_config')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'raffle_config' }, payload => {
        setConfig(payload.new.data);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ticketsChannel);
      supabase.removeChannel(configChannel);
      supabase.removeChannel(sellersChannel);
    };
  }, []);

  const updateTicketsBatch = async (ids: string[], updates: Partial<Ticket>) => {
    // First update local state for immediate feedback (optimistic update)
    setTickets(prev => prev.map(t => ids.includes(t.id) ? { ...t, ...updates } : t));

    // Then update Supabase
    const { error } = await supabase
      .from('tickets')
      .upsert(ids.map(id => ({ id, ...updates })));

    if (error) console.error("Error updating tickets:", error);
  };

  const updateTicket = (id: string, updates: Partial<Ticket>) => {
    updateTicketsBatch([id], updates);
  };

  const handleUpdateConfig = async (newConfig: RaffleConfig) => {
    if (newConfig.totalNumbers !== config.totalNumbers) {
      if (confirm(`Al cambiar la cantidad de números a ${newConfig.totalNumbers} se reiniciará el talonario en la nube. ¿Deseas continuar?`)) {
        const padLen = newConfig.totalNumbers > 100 ? 3 : 2;
        const newTickets: Ticket[] = Array.from({ length: newConfig.totalNumbers }, (_, i) => ({
          id: i.toString().padStart(padLen, '0'),
          status: TicketStatus.AVAILABLE
        }));

        // Reset DB tickets
        await supabase.from('tickets').delete().neq('id', 'null');
        await supabase.from('tickets').insert(newTickets);

        setTickets(newTickets);
        setSelectedIds([]);
      } else {
        return;
      }
    }

    // Update config in Supabase
    await supabase.from('raffle_config').update({ data: newConfig }).eq('id', 1);
    setConfig(newConfig);
  };

  // Create Seller
  const handleCreateSeller = async (name: string, pin: string) => {
    const { data, error } = await supabase.from('sellers').insert({ name, pin }).select();
    if (error) alert("Error creando vendedor: " + error.message);
    // Realtime subscription will update state
  };

  // Delete Seller
  const handleDeleteSeller = async (id: string) => {
    if (!confirm("¿Eliminar vendedor?")) return;
    const { error } = await supabase.from('sellers').delete().eq('id', id);
    if (error) alert("Error eliminando: " + error.message);
  };

  const handleNavigate = (view: View) => {
    if (view === 'ADMIN' || view === 'SORTEADOR') {
      if (!isAdminAuthenticated) {
        setPendingView(view);
        setShowLogin(true);
        return;
      }
    }
    // Seller Dashboard Check
    if (view === 'SELLER_DASHBOARD') {
      if (!currentSeller) {
        setPendingView('SELLER_DASHBOARD');
        setShowLogin(true);
        return;
      }
    }

    setCurrentView(view);
  };

  const onLoginSuccess = (userType: 'admin' | 'seller', sellerData?: Seller) => {
    if (userType === 'admin') {
      setIsAdminAuthenticated(true);
      setCurrentSeller(null);
    } else if (userType === 'seller' && sellerData) {
      setCurrentSeller(sellerData);
      setIsAdminAuthenticated(false);
    }

    setShowLogin(false);

    if (pendingView) {
      // If we were going to admin but logged in as seller -> force dashboard
      if (userType === 'seller') setCurrentView('SELLER_DASHBOARD');
      else setCurrentView(pendingView);

      setPendingView(null);
    } else {
      // Default destinations
      if (userType === 'admin') setCurrentView('ADMIN');
      if (userType === 'seller') setCurrentView('SELLER_DASHBOARD');
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-black flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-amber-500 font-premium tracking-widest animate-pulse">CARGANDO CASINO...</p>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col w-full mx-auto relative bg-[#050505] overflow-hidden shadow-2xl">

      {/* ========== HOME VIEW ========== */}
      {currentView === 'HOME' && (
        <div className="flex-1 flex flex-col items-center justify-start px-6 pt-10 pb-32 relative overflow-y-auto scrollbar-hide">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <div className="absolute inset-0 bg-gradient-radial from-amber-900/20 via-transparent to-transparent pointer-events-none"></div>

            {config.announcement && (
              <div className="w-full flex-none bg-amber-500/10 border-y border-amber-500/30 py-2 px-4 mb-6 flex items-center justify-center gap-2 overflow-hidden">
                <div className="flex gap-4 animate-marquee whitespace-nowrap">
                  <span className="text-amber-500 font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    {config.announcement}
                  </span>
                  <span className="text-amber-500 font-black text-[10px] uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                    {config.announcement}
                  </span>
                </div>
              </div>
            )}

            {/* Referral Badge */}
            {referralSellerId && (
              <div className="mb-4 bg-green-900/40 px-4 py-1 rounded-full border border-green-500/30">
                <span className="text-[9px] text-green-400 font-bold uppercase tracking-widest">
                  REFERIDO POR {sellers.find(s => s.id === referralSellerId)?.name || 'VENDEDOR'}
                </span>
              </div>
            )}

            <div
              className="relative mb-6 flex-none cursor-pointer"
              onClick={() => {
                const newClicks = logoClicks + 1;
                if (newClicks >= 5) {
                  // Admin access shortcut
                  setPendingView('ADMIN');
                  setShowLogin(true);
                  setLogoClicks(0);
                } else {
                  setLogoClicks(newClicks);
                  // Reset clicks after 3 seconds of inactivity
                  setTimeout(() => setLogoClicks(0), 3000);
                }
              }}
            >
              <img src="https://i.imgur.com/82qB1IO.png" alt="Logo" className="w-full max-w-[500px] h-auto object-contain drop-shadow-[0_0_30px_rgba(212,175,55,0.5)]" />
            </div>

            {config.alert && (config.alert.title || config.alert.message) && (
              <div className={`w-full max-w-[340px] flex-none rounded-2xl p-4 mb-3 border relative overflow-hidden animate-in fade-in zoom-in-95
              ${config.alert.type === 'warning' ? 'bg-orange-600/10 border-orange-500/50' :
                  config.alert.type === 'success' ? 'bg-green-600/10 border-green-500/50' :
                    'bg-amber-600/10 border-amber-500/50'}
            `}>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-2 border-b border-white/5 pb-2">
                    <div className={`p-1.5 rounded-lg flex-none ${config.alert.type === 'warning' ? 'bg-orange-500' : config.alert.type === 'success' ? 'bg-green-500' : 'bg-amber-500'} text-black shadow-sm`}>
                      <Icons.Trophy />
                    </div>
                    <h3 className="text-white font-premium text-base uppercase tracking-tight leading-none">{config.alert.title || "AVISO"}</h3>
                  </div>
                  <p className="text-gray-200 text-xs font-medium leading-normal px-0.5">{config.alert.message}</p>
                </div>
              </div>
            )}

            {config.winnerInfo && (
              <div className="w-full max-w-[340px] flex-none bg-red-600/10 border-y border-red-600/30 py-1.5 px-4 mb-4 flex items-center justify-between animate-pulse">
                <span className="text-red-500 text-[9px] font-black uppercase tracking-widest">¡GANADOR!</span>
                <span className="text-white text-xs font-bold truncate px-2">{config.winnerInfo.name}</span>
                <span className="text-white/50 text-[9px] font-black">#{config.winnerInfo.ticketId}</span>
              </div>
            )}

            <div className="relative mb-8">
              <div className="absolute -top-3 left-0 right-0 flex justify-around">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                  <div key={`top-${i}`} className={`w-3 h-3 rounded-full bg-amber-400 casino-light casino-light-delay-${i % 5}`} style={{ boxShadow: '0 0 10px #fbbf24' }}></div>
                ))}
              </div>
              <div className="absolute -bottom-3 left-0 right-0 flex justify-around">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                  <div key={`bottom-${i}`} className={`w-3 h-3 rounded-full bg-red-500 casino-light casino-light-delay-${(i + 2) % 5}`} style={{ boxShadow: '0 0 10px #ef4444' }}></div>
                ))}
              </div>
              <div className="absolute -left-3 top-0 bottom-0 flex flex-col justify-around">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={`left-${i}`} className={`w-3 h-3 rounded-full bg-green-400 casino-light casino-light-delay-${(i + 1) % 5}`} style={{ boxShadow: '0 0 10px #4ade80' }}></div>
                ))}
              </div>
              <div className="absolute -right-3 top-0 bottom-0 flex flex-col justify-around">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={`right-${i}`} className={`w-3 h-3 rounded-full bg-amber-400 casino-light casino-light-delay-${(i + 3) % 5}`} style={{ boxShadow: '0 0 10px #fbbf24' }}></div>
                ))}
              </div>
              <div className="jackpot-frame w-full max-w-[500px] rounded-2xl overflow-hidden border-4 border-amber-500 bg-black relative z-10 self-center">
                <div className="relative w-full aspect-[4/3] flex items-center justify-center p-4 bg-gradient-to-b from-gray-900 to-black">
                  <img
                    key={config.prizeImage}
                    src={config.prizeImage || 'https://i.ibb.co/3ykZqK5/iphone-prize.jpg'}
                    alt={config.prizeName}
                    className="w-full h-full object-contain relative z-20"
                    crossOrigin="anonymous"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.src.includes('placeholder')) {
                        target.src = 'https://placehold.co/800x600/000000/F59E0B?text=IMAGEN+NO+DISPONIBLE';
                      }
                    }}
                  />

                  {/* Text Overlay at bottom */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 text-center bg-black/60 backdrop-blur-sm z-30 border-t border-white/10">
                    <p className="text-amber-400 text-[8px] font-black uppercase tracking-[0.3em] mb-0.5">PREMIO MAYOR</p>
                    <h2 className="text-white font-premium text-base uppercase leading-tight">{config.prizeName}</h2>
                  </div>
                </div>
              </div>
            </div>

            <div className="gold-gradient px-8 py-3 rounded-full mb-8 shadow-lg flex flex-col items-center">
              <div>
                <span className="text-black font-black text-2xl">${config.ticketPrice}</span>
                <span className="text-black/70 text-sm font-bold ml-2">por número</span>
              </div>
              {config.exchangeRate && config.exchangeRate > 0 && (
                <div className="text-black font-bold text-xs">
                  Bs. {(config.ticketPrice * config.exchangeRate).toLocaleString()}
                </div>
              )}
            </div>

            <button
              onClick={() => setIsNumbersModalOpen(true)}
              className="w-full max-w-lg gold-gradient p-6 rounded-3xl shadow-[0_15px_40px_rgba(245,158,11,0.3)] mb-8 animate-pulse-slow active:scale-95 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="text-left leading-none uppercase italic">
                  <p className="text-black font-black text-xs opacity-50 mb-1">¡PARTICIPA YA!</p>
                  <p className="text-black font-black text-2xl tracking-tighter">ELEGIR NÚMEROS</p>
                </div>
                <div className="bg-black/10 p-2 rounded-xl group-hover:translate-x-2 transition-transform">➔</div>
              </div>
            </button>

            <div className="w-full max-w-lg mb-12 flex-none">
              <button
                onClick={() => {
                  const msg = `Hola, quiero reportar mi pago de la rifa. Adjunto mi captura/archivo.`;
                  window.open(`https://wa.me/${config.paymentWhatsapp || ''}?text=${encodeURIComponent(msg)}`, '_blank');
                }}
                className="w-full bg-white/5 border border-white/10 hover:bg-white/10 active:bg-white/5 transition-all p-4 rounded-2xl flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-green-500 text-black p-2 rounded-xl group-hover:scale-110 transition-transform shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                    <Icons.Whatsapp />
                  </div>
                  <div className="text-left">
                    <p className="text-white font-black text-[10px] uppercase tracking-widest leading-none mb-1">Reportar Pago</p>
                    <p className="text-gray-500 text-[9px] font-bold">Envía captura o archivo por aquí</p>
                  </div>
                </div>
                <div className="text-amber-500 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all">➔</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {currentView !== 'HOME' && (
        <main className="flex-1 overflow-y-auto px-4 scroll-smooth pb-safe pt-4">
          {currentView === 'ADMIN' && (
            <AdminPanel
              tickets={tickets}
              config={config}
              onUpdateTicket={updateTicket}
              onUpdateConfig={handleUpdateConfig}
              soundsEnabled={soundsEnabled}
              onToggleSounds={() => setSoundsEnabled(!soundsEnabled)}
              sellers={sellers}
              onCreateSeller={handleCreateSeller}
              onDeleteSeller={handleDeleteSeller}
            />
          )}
          {currentView === 'SORTEADOR' && (
            <Sorteador tickets={tickets} />
          )}
          {currentView === 'SELLER_DASHBOARD' && currentSeller && (
            <SellerDashboard
              seller={currentSeller}
              tickets={tickets}
              config={config}
              onUpdateTicket={updateTicket}
              onLogout={() => {
                setCurrentSeller(null);
                setCurrentView('HOME');
              }}
            />
          )}
          <div className="h-28"></div>
        </main>
      )}

      {isNumbersModalOpen && (
        <div className="fixed inset-0 z-[80] flex">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setIsNumbersModalOpen(false)}></div>
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-[380px] bg-[#0a0a0a] border-l border-amber-500/30 slide-in-right flex flex-col">
            <div className="flex-none p-4 border-b border-amber-500/20 flex items-center justify-between bg-black/50">
              <h3 className="gold-text font-premium text-xl uppercase tracking-wider">Seleccionar Números</h3>
              <button onClick={() => setIsNumbersModalOpen(false)} className="text-gray-500 hover:text-white text-2xl">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <Home
                tickets={tickets}
                config={config}
                selectedInSession={selectedIds}
                onToggleSelection={(id) => {
                  setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
                }}
                onCheckout={() => {
                  playSound(SOUNDS.CHECKOUT);
                  setIsNumbersModalOpen(false);
                  setIsCheckoutOpen(true);
                }}
                playSound={playSound}
              />
            </div>
          </div>
        </div>
      )}

      <nav className="flex-none bg-black/90 backdrop-blur-xl border-t border-amber-500/30 px-6 py-4 pb-safe flex justify-between items-center z-50">
        <button onClick={() => handleNavigate('HOME')} className={`flex flex-col items-center gap-1 transition-all ${currentView === 'HOME' ? 'text-amber-500 scale-110' : 'text-gray-500'}`}>
          <Icons.Home /><span className="text-[9px] font-black uppercase tracking-tighter">Talonario</span>
        </button>

        {/* If Seller is Logged In, show Dashboard Link */}
        {currentSeller && (
          <button onClick={() => handleNavigate('SELLER_DASHBOARD')} className={`flex flex-col items-center gap-1 transition-all ${currentView === 'SELLER_DASHBOARD' ? 'text-amber-500 scale-110' : 'text-gray-500'}`}>
            <Icons.Users /><span className="text-[9px] font-black uppercase tracking-tighter">Ventas ({currentSeller.name})</span>
          </button>
        )}

        {/* If Admin is Logged In, show Admin Links */}
        {isAdminAuthenticated && (
          <>
            <button onClick={() => handleNavigate('ADMIN')} className={`flex flex-col items-center gap-1 transition-all ${currentView === 'ADMIN' ? 'text-amber-500 scale-110' : 'text-gray-500'}`}>
              <Icons.Admin /><span className="text-[9px] font-black uppercase tracking-tighter">Admin</span>
            </button>
            <button onClick={() => handleNavigate('SORTEADOR')} className={`flex flex-col items-center gap-1 transition-all ${currentView === 'SORTEADOR' ? 'text-amber-500 scale-110' : 'text-gray-500'}`}>
              <Icons.Trophy /><span className="text-[9px] font-black uppercase tracking-tighter">Sorteo</span>
            </button>
          </>
        )}

        {/* Invisible login button if no one logged in */}
        {!isAdminAuthenticated && !currentSeller && (
          <button onClick={() => setShowLogin(true)} className="opacity-0 w-8 h-8"></button>
        )}
      </nav>

      {showLogin && (
        <AdminLogin
          onSuccess={onLoginSuccess}
          onClose={() => setShowLogin(false)}
          correctPin={ADMIN_PIN}
          sellers={sellers}
        />
      )}

      {isCheckoutOpen && (
        <TicketOverlay
          selectedIds={selectedIds}
          config={config}
          onClose={() => setIsCheckoutOpen(false)}
          onReserve={async (name, phone) => {
            const receiptId = `BR-${Math.floor(1000 + Math.random() * 9000)}`;
            const total = selectedIds.length * config.ticketPrice;
            const nums = selectedIds.join(', ');

            const updates: Partial<Ticket> = {
              status: TicketStatus.APARTADO,
              participant: { name, phone, timestamp: Date.now(), receiptId }
            };

            // Assign to seller if referral exists or currently logged in seller creates it (though sellers usually use share link)
            if (referralSellerId) {
              updates.sellerId = referralSellerId;
            } else if (currentSeller) {
              updates.sellerId = currentSeller.id;
            }

            await updateTicketsBatch(selectedIds, updates);

            const message = `🎟️ *RECIBO DE APARTADO - ${receiptId}* 🎟️%0A%0A👤 *Cliente:* ${name}%0A🎰 *Números:* [ ${nums} ]%0A💰 *Total a pagar:* $${total}%0A%0A⚠️ *ESTADO: NÚMERO POR REVISAR*%0A%0A❗ *IMPORTANTE:* El número debe estar pagado para ser válido. *NÚMERO NO PAGADO NO JUEGA EN EL SORTEO*. Debes pagar el número seleccionado para asegurar su cupo. %0A%0A📱 Favor de enviar el comprobante de pago por aquí.`;
            const url = `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${message}`;
            window.open(url, '_blank');
            setSelectedIds([]);
            setIsCheckoutOpen(false);
          }}
        />
      )}

      {/* Floating Engagement Message */}
      {engagementMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-[280px] animate-float-up px-4">
          <div className="bg-amber-500/95 text-black font-black text-[12px] p-4 rounded-3xl shadow-[0_15px_40px_rgba(245,158,11,0.6)] backdrop-blur-md text-center uppercase tracking-tighter border-2 border-white/20">
            {engagementMessage}
          </div>
        </div>
      )}
    </div>
  );
};

const AdminLogin: React.FC<{
  onSuccess: (type: 'admin' | 'seller', seller?: Seller) => void,
  onClose: () => void,
  correctPin: string,
  sellers: Seller[]
}> = ({ onSuccess, onClose, correctPin, sellers }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const handlePin = (digit: string) => {
    const newPin = pin + digit;
    // Max length heuristic: 4 or match master
    if (newPin.length > Math.max(correctPin.length, 4)) return;

    setPin(newPin);

    // Check Master Admin
    if (newPin === correctPin) {
      onSuccess('admin');
      return;
    }

    // Check Sellers
    const matchedSeller = sellers.find(s => s.pin === newPin && s.active);
    if (matchedSeller) {
      onSuccess('seller', matchedSeller);
      return;
    }
  };

  // Auto-clear logic handled manually

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
      <div className="mb-8 text-center">
        <div className="text-amber-500 flex justify-center scale-150 mb-6"><Icons.Lock /></div>
        <h2 className="font-premium text-2xl gold-text mb-1 tracking-widest">ACCESO</h2>
        <p className="text-gray-600 text-[9px] uppercase tracking-[0.3em] font-black">ADMIN O VENDEDOR</p>
      </div>
      <div className="flex gap-4 mb-10 h-12 justify-center">
        {pin.split('').map((_, i) => (
          <div key={i} className="w-4 h-4 rounded-full bg-amber-500 animate-pulse"></div>
        ))}
        {pin.length === 0 && <span className="text-gray-700 text-xs tracking-widest">INGRESE PIN</span>}
      </div>
      <div className="grid grid-cols-3 gap-4 w-full max-w-[280px]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'X'].map((val, idx) => (
          <button key={idx} onClick={() => { if (val === 'X') setPin(pin.slice(0, -1)); else if (val) handlePin(val); }} className={`aspect-square rounded-2xl flex items-center justify-center text-2xl font-black transition-all active:scale-90 ${!val ? 'invisible' : val === 'X' ? 'text-red-500' : 'bg-white/5 text-white hover:bg-white/10 border border-white/5'}`}>
            {val}
          </button>
        ))}
      </div>
      <button onClick={onClose} className="mt-10 text-gray-600 text-[10px] font-black uppercase tracking-widest underline decoration-amber-500/30">CANCELAR</button>
    </div>
  );
};

const TicketOverlay: React.FC<{
  selectedIds: string[],
  config: RaffleConfig,
  onClose: () => void,
  onReserve: (name: string, phone: string) => void
}> = ({ selectedIds, config, onClose, onReserve }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const totalPrice = selectedIds.length * config.ticketPrice;
  const totalPriceBs = config.exchangeRate ? (totalPrice * config.exchangeRate) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/95 animate-in fade-in">
      <div className="casino-card w-full max-w-sm rounded-[32px] overflow-hidden relative shadow-2xl shadow-amber-500/10 flex flex-col">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-500 hover:text-white z-10 text-xl">✕</button>
        <div className="p-8 flex flex-col items-center text-center">
          <h2 className="font-premium text-3xl gold-text mb-2 uppercase italic tracking-tighter">RESERVAR</h2>
          <div className="mb-6 w-full">
            <span className="text-[10px] text-gray-600 uppercase font-black block mb-3 tracking-widest">FICHAS SELECCIONADAS</span>
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              {selectedIds.map(id => <span key={id} className="bg-amber-500 text-black px-3 py-1 rounded-lg font-black text-lg shadow-lg">{id}</span>)}
            </div>
            <div className="border-t border-white/5 pt-4 flex flex-col items-center px-2">
              <span className="text-gray-500 uppercase text-[10px] font-black tracking-widest mb-1">TOTAL APOSTADO</span>
              <span className="text-3xl gold-text font-premium font-black">${totalPrice}</span>
              {totalPriceBs > 0 && <span className="text-md text-gray-400 font-bold">Bs. {totalPriceBs.toLocaleString()}</span>}
            </div>
          </div>
          <div className="w-full space-y-4">
            <input type="text" placeholder="NOMBRE COMPLETO" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-amber-500 transition-colors placeholder:text-gray-700 text-sm font-bold" />
            <input type="tel" placeholder="NÚMERO WHATSAPP" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full bg-black/60 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-amber-500 transition-colors placeholder:text-gray-700 text-sm font-bold" />
            <button onClick={() => name && phone && onReserve(name, phone)} disabled={!name || !phone} className="w-full gold-gradient text-black font-black py-5 rounded-2xl shadow-xl hover:brightness-110 active:scale-95 transition-all disabled:opacity-30 uppercase tracking-widest text-sm">SOLICITAR APARTADO</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
