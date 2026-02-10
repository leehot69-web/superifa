
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { supabase } from './supabase';

// ============================================================
// TIPOS
// ============================================================
type TicketStatus = 'AVAILABLE' | 'REVISANDO' | 'PAGADO';
interface Prize { id: string; name: string; subtitle: string; image: string; }
interface Ticket {
  id: string;
  status: TicketStatus;
  participant?: { name: string; phone: string; timestamp: number; };
  sellerId?: string;
  seller_id?: string; // Supabase usa snake_case
}
interface Seller { id: string; name: string; pin: string; commissionRate: number; active?: boolean; }
interface Winner { number: string; name: string; date: string; prize: string; }
interface RaffleConfig {
  prizes: Prize[];
  ticketPriceUsd: number;
  ticketPriceLocal: number;
  drawTimestamp: string;
  drawTitle: string;
  whatsapp: string;
  commissionPct: number;
  tickerMessage: string;
  winners: Winner[];
}

const ADMIN_PIN = "11863";

// --- Recursos Locales (servidos desde /public) ---
const SPLASH_VIDEO = "/introsuperrifa.mp4";
const ENTRY_VIDEO = "/videosuperrifa.mp4";
const LOGO = "/descarga-removebg-preview.png";

// ============================================================
// APP
// ============================================================
const App = () => {
  // --- Loading State ---
  const [isLoading, setIsLoading] = useState(true);

  // --- Splash ---
  const [splash, setSplash] = useState<'IDLE' | 'SPLASH' | 'ENTRY' | 'DONE'>('IDLE');
  const vidRef = useRef<HTMLVideoElement>(null);

  // --- Config ---
  const DEFAULT_CONFIG: RaffleConfig = {
    drawTitle: "GRAN RIFA",
    tickerMessage: "¡La suerte te espera hoy! 🎰 Gran Premio Mayor disponible",
    winners: [],
    whatsapp: "584120000000",
    ticketPriceUsd: 10,
    ticketPriceLocal: 360,
    drawTimestamp: "2024-12-31T20:00",
    commissionPct: 10,
    prizes: [
      { id: '1', name: 'iPhone 15 Pro Max', subtitle: 'El premio que cambia tu vida', image: 'https://images.unsplash.com/photo-1696446701796-da61225697cc?q=80&w=1000&auto=format' },
      { id: '2', name: 'Watch Ultra', subtitle: 'Luxury Edition', image: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&q=80&w=400' },
      { id: '3', name: 'PS5 Console', subtitle: 'Gaming Premium', image: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?auto=format&fit=crop&q=80&w=400' }
    ]
  };

  const [config, setConfig] = useState<RaffleConfig>(DEFAULT_CONFIG);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);

  // --- UI State ---
  const [view, setView] = useState<'HOME' | 'TALONARIO' | 'ADMIN' | 'SELLER_HUB'>('HOME');
  const [adminTab, setAdminTab] = useState<'CONFIG' | 'SELLERS' | 'VENTAS'>('CONFIG');
  const [currentSeller, setCurrentSeller] = useState<Seller | null>(null);
  const [showLogin, setShowLogin] = useState<'ADMIN' | 'SELLER' | null>(null);
  const [pin, setPin] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [ticketCount, setTicketCount] = useState<number>(100);
  const [selectedSeller, setSelectedSeller] = useState<Seller | null>(null);
  const [warningModal, setWarningModal] = useState<{ show: boolean; tickets: Ticket[]; newCount: number }>({ show: false, tickets: [], newCount: 0 });
  const [referralId, setReferralId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [showGoldenTicket, setShowGoldenTicket] = useState<{ show: boolean; numbers: string[] }>({ show: false, numbers: [] });
  const [showAffiliateModal, setShowAffiliateModal] = useState(false);
  const [modal, setModal] = useState<{
    show: boolean;
    type: 'ALERT' | 'CONFIRM' | 'SELLER_FORM';
    title: string;
    message: string;
    onConfirm?: (val1?: string, val2?: string) => void;
  }>({ show: false, type: 'ALERT', title: '', message: '' });

  const isAdmin = view === 'ADMIN';
  const isSeller = view === 'SELLER_HUB';

  const showAlert = (title: string, message: string) => setModal({ show: true, type: 'ALERT', title, message });
  const showConfirm = (title: string, message: string, onConfirm: () => void) => setModal({ show: true, type: 'CONFIRM', title, message, onConfirm });
  const showSellerForm = (onConfirm: (name: string, pin: string) => void) => setModal({ show: true, type: 'SELLER_FORM', title: 'NUEVO DISTRIBUIDOR', message: '', onConfirm: (v1, v2) => onConfirm(v1 || '', v2 || '') });

  // --- Referral Sensor ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('kerifa_ref', ref);
      setReferralId(ref);
    } else {
      setReferralId(localStorage.getItem('kerifa_ref'));
    }
  }, []);


  // --- Countdown ---
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0, expired: false });
  useEffect(() => {
    const update = () => {
      const target = new Date(config.drawTimestamp).getTime();
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) { setCountdown({ days: 0, hours: 0, mins: 0, secs: 0, expired: true }); return; }
      setCountdown({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        mins: Math.floor((diff % 3600000) / 60000),
        secs: Math.floor((diff % 60000) / 1000),
        expired: false
      });
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [config.drawTimestamp]);

  // --- Supabase: Carga inicial y sincronización en tiempo real ---
  useEffect(() => {
    const fetchInitialData = async () => {
      if (!supabase) {
        console.error("Supabase client is not initialized.");
        setIsLoading(false);
        return;
      }
      setIsLoading(true);

      try {
        // 1. Cargar Config
        const { data: configData } = await supabase
          .from('kerifa_config')
          .select('data')
          .eq('id', 1)
          .single();

        if (configData?.data) {
          setConfig({ ...DEFAULT_CONFIG, ...configData.data });
        }

        // 2. Cargar Sellers (tabla compartida con RIFA1000)
        const { data: sellersData } = await supabase
          .from('sellers')
          .select('*');

        if (sellersData) {
          setSellers(sellersData.map((s: any) => ({
            id: s.id,
            name: s.name,
            pin: s.pin,
            active: s.active ?? true,
            commissionRate: s.commission_count || 0.1
          })));
        }

        // 3. Cargar Tickets
        const { data: ticketsData } = await supabase
          .from('kerifa_tickets')
          .select('*')
          .order('id', { ascending: true });

        if (ticketsData && ticketsData.length > 0) {
          setTickets(ticketsData.map((t: any) => ({
            id: t.id,
            status: t.status,
            participant: t.participant,
            sellerId: t.seller_id
          })));
          setTicketCount(ticketsData.length);
        } else {
          // Si no hay tickets, inicializar con 100
          const initialTickets = Array.from({ length: 100 }, (_, i) => ({
            id: i.toString().padStart(3, '0'),
            status: 'AVAILABLE' as TicketStatus
          }));
          await supabase.from('kerifa_tickets').insert(initialTickets);
          setTickets(initialTickets);
          setTicketCount(100);
        }
      } catch (error) {
        console.error('Error cargando datos:', error);
        showAlert('ERROR', 'No se pudieron cargar los datos de la base de datos.');
      }

      setIsLoading(false);
    };

    fetchInitialData();

    // 4. Realtime: Canales (Solo si supabase existe)
    if (!supabase) return;

    const ticketsChannel = supabase
      .channel('kerifa_tickets_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kerifa_tickets' }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          const updated = payload.new as any;
          setTickets(prev => {
            const index = prev.findIndex(t => t.id === updated.id);
            const ticket: Ticket = {
              id: updated.id,
              status: updated.status,
              participant: updated.participant,
              sellerId: updated.seller_id
            };
            if (index === -1) return [...prev, ticket].sort((a, b) => a.id.localeCompare(b.id));
            const newTickets = [...prev];
            newTickets[index] = ticket;
            return newTickets;
          });
        } else if (payload.eventType === 'DELETE') {
          setTickets(prev => prev.filter(t => t.id !== payload.old.id));
        }
      })
      .subscribe();

    const configChannel = supabase
      .channel('kerifa_config_channel')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'kerifa_config' }, (payload) => {
        const newData = (payload.new as any).data;
        setConfig({ ...DEFAULT_CONFIG, ...newData });
      })
      .subscribe();

    const sellersChannel = supabase
      .channel('sellers_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sellers' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const s = payload.new as any;
          setSellers(prev => [...prev, { id: s.id, name: s.name, pin: s.pin, active: s.active ?? true, commissionRate: s.commission_count || 0.1 }]);
        } else if (payload.eventType === 'DELETE') {
          setSellers(prev => prev.filter(s => s.id !== payload.old.id));
        } else if (payload.eventType === 'UPDATE') {
          const s = payload.new as any;
          setSellers(prev => prev.map(seller => seller.id === s.id ? { id: s.id, name: s.name, pin: s.pin, active: s.active ?? true, commissionRate: s.commission_count || 0.1 } : seller));
        }
      })
      .subscribe();

    return () => {
      if (ticketsChannel) supabase.removeChannel(ticketsChannel);
      if (configChannel) supabase.removeChannel(configChannel);
      if (sellersChannel) supabase.removeChannel(sellersChannel);
    };
  }, []);

  const isClientMode = useMemo(() => new URLSearchParams(window.location.search).has('ref'), []);

  const ticketStats = useMemo(() => {
    const sold = tickets.filter(t => t.status !== 'AVAILABLE');
    const paid = tickets.filter(t => t.status === 'PAGADO');
    return { sold: sold.length, paid: paid.length, available: tickets.length - sold.length, totalPaid: paid.length * config.ticketPriceUsd };
  }, [tickets, config]);

  const sellerStats = useMemo(() => {
    if (!currentSeller) return { totalSales: 0, count: 0, commission: 0 };
    const my = tickets.filter(t => t.sellerId === currentSeller.id && t.status !== 'AVAILABLE');
    const totalSales = my.length * config.ticketPriceUsd;
    // Usar la comisión del vendedor si existe, sino la global
    const rate = (currentSeller.commissionRate !== undefined && currentSeller.commissionRate !== 0.1)
      ? currentSeller.commissionRate
      : (config.commissionPct / 100);
    return { totalSales, count: my.length, commission: totalSales * rate, ratePct: rate * 100 };
  }, [tickets, currentSeller, config]);

  // --- Supabase Write Handlers ---
  const updateTicketInSupabase = async (id: string, updates: Partial<Ticket>) => {
    const sbUpdates: any = { ...updates };
    if ('sellerId' in updates) { sbUpdates.seller_id = updates.sellerId; delete sbUpdates.sellerId; }
    setTickets(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    const { error } = await supabase.from('kerifa_tickets').update(sbUpdates).eq('id', id);
    if (error) console.error("Error updating ticket:", error);
  };

  const updateConfigInSupabase = async (newConfig: RaffleConfig) => {
    setConfig(newConfig);
    const { error } = await supabase.from('kerifa_config').update({ data: newConfig }).eq('id', 1);
    if (error) console.error("Error updating config:", error);
  };

  const createSellerInSupabase = async (name: string, pin: string) => {
    const { data, error } = await supabase.from('sellers').insert([{ name, pin, active: true }]).select();
    if (error) { showAlert('ERROR', "No se pudo crear el vendedor: " + error.message); return null; }
    return data[0];
  };

  const createApplicationInSupabase = async (formData: any) => {
    setIsLoading(true);
    const { error } = await supabase.from('kerifa_applications').insert([formData]);
    setIsLoading(false);
    if (error) {
      showAlert('ERROR', 'No se pudo enviar la solicitud: ' + error.message);
    } else {
      const waMsg = `🚀 *NUEVA SOLICITUD DE AFILIADO* 🚀\n\n👤 *Nombre:* ${formData.full_name}\n🆔 *Cédula:* ${formData.id_number}\n🏠 *Dirección:* ${formData.address}\n📱 *WhatsApp:* ${formData.phone}\n📞 *Familiar:* ${formData.family_phone}\n\n_Favor contactar para validación de documentos._`;
      window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(waMsg)}`, '_blank');

      showAlert('ÉXITO', 'Solicitud registrada correctamente. Se ha abierto WhatsApp para notificar al administrador.');
      setShowAffiliateModal(false);
    }
  };

  const deleteSellerInSupabase = async (id: string) => {
    showConfirm('⚠️ ELIMINAR', '¿Estás seguro de que quieres eliminar este vendedor?', async () => {
      const { error } = await supabase.from('sellers').delete().eq('id', id);
      if (error) showAlert('ERROR', "No se pudo eliminar: " + error.message);
      else { setSellers(prev => prev.filter(s => s.id !== id)); setSelectedSeller(null); }
    });
  };

  const handleLogin = () => {
    if (showLogin === 'ADMIN' && pin === ADMIN_PIN) { setView('ADMIN'); setShowLogin(null); }
    else if (showLogin === 'SELLER') {
      const s = sellers.find(x => x.pin === pin);
      if (s) { setCurrentSeller(s); setView('SELLER_HUB'); setShowLogin(null); }
      else showAlert('ACCESO DENEGADO', "El PIN ingresado es incorrecto.");
    }
    setPin('');
  };

  const handleVideoEnd = () => {
    console.log("🎬 Video finalizado. Estado actual:", splash);
    if (splash === 'SPLASH') setSplash('ENTRY');
    else setSplash('DONE');
  };

  // --- Regenerar tabla de tickets ---
  const regenerateTickets = (count: number) => {
    if (count < tickets.length) {
      const affectedTickets = tickets.filter(t => { const num = parseInt(t.id); return num >= count && t.status !== 'AVAILABLE'; });
      if (affectedTickets.length > 0) { setWarningModal({ show: true, tickets: affectedTickets, newCount: count }); return; }
    }
    applyTicketChange(count);
  };

  const applyTicketChange = async (count: number) => {
    setIsLoading(true);
    const padLen = count >= 1000 ? 4 : count >= 100 ? 3 : 2;
    const newTickets: Ticket[] = Array.from({ length: count }, (_, i) => {
      const id = i.toString().padStart(padLen, '0');
      const existing = tickets.find(t => t.id === id);
      return existing || { id, status: 'AVAILABLE' as TicketStatus };
    });

    try {
      // Eliminar tickets fuera de rango
      const maxId = (count - 1).toString().padStart(padLen, '0');
      // Nota: Filtrar por ID mayor al nuevo límite es difícil con strings de longitudes variables, 
      // pero aquí asumimos que todos los IDs tienen el mismo padding en la fase actual.
      await supabase.from('kerifa_tickets').delete().gt('id', maxId);

      // Upsert todos los tickets
      const sbTickets = newTickets.map(t => ({
        id: t.id,
        status: t.status,
        participant: t.participant,
        seller_id: t.sellerId
      }));
      await supabase.from('kerifa_tickets').upsert(sbTickets);

      setTickets(newTickets);
      setTicketCount(count);
      setSelection([]);
      setWarningModal({ show: false, tickets: [], newCount: 0 });
      showAlert('ÉXITO', "Talonario sincronizado correctamente.");
    } catch (e) {
      console.error(e);
      showAlert('ERROR', "Error al sincronizar el talonario.");
    }
    setIsLoading(false);
  };

  // --- Reiniciar todo a cero ---
  const resetEverything = async () => {
    showConfirm('⚠️ REINICIO TOTAL', '¿Estás seguro de que quieres borrar TODAS las ventas y empezar de cero? Esta acción no se puede deshacer.', async () => {
      setIsLoading(true);
      const padLen = ticketCount >= 1000 ? 4 : ticketCount >= 100 ? 3 : 2;
      const cleanTickets = Array.from({ length: ticketCount }, (_, i) => ({ id: i.toString().padStart(padLen, '0'), status: 'AVAILABLE' as TicketStatus }));

      try {
        await supabase.from('kerifa_tickets').delete().neq('id', 'RESET');
        await supabase.from('kerifa_tickets').insert(cleanTickets.map(t => ({ id: t.id, status: t.status as string })));
        setTickets(cleanTickets);
        setSelection([]);
        showAlert('ÉXITO', 'Todo ha sido reiniciado correctamente.');
      } catch (e) {
        console.error(e);
        showAlert('ERROR', "Error al intentar reiniciar los datos.");
      }
      setIsLoading(false);
    });
  };

  // ============================================================
  // RENDER: SPLASH
  // ============================================================
  const renderSplash = () => (
    <div className="fixed inset-0 z-[9000] bg-black flex flex-col items-center justify-center overflow-hidden">
      {splash === 'IDLE' && (
        <div className="flex flex-col items-center gap-12">
          <img src={LOGO} className="w-64 drop-shadow-[0_0_40px_rgba(212,175,55,0.5)]" />
          <button onClick={() => setSplash('SPLASH')} className="gold-gradient text-black px-16 py-6 rounded-full font-extrabold text-xl uppercase tracking-widest shadow-gold-glow active:scale-95 transition-all">
            INICIAR SORTEO
          </button>
          <p className="text-primary/40 text-[10px] uppercase tracking-[0.4em] font-bold animate-pulse">Pulsa para iniciar con audio</p>
        </div>
      )}
      {(splash === 'SPLASH' || splash === 'ENTRY') && (
        <div className="w-full h-full relative">
          <video ref={vidRef} src={splash === 'SPLASH' ? SPLASH_VIDEO : ENTRY_VIDEO} autoPlay onEnded={handleVideoEnd} className="w-full h-full object-contain md:object-cover" />
          <button onClick={() => setSplash('DONE')} className="absolute bottom-10 right-10 glass text-white/60 px-8 py-3 rounded-full text-[10px] font-bold uppercase tracking-widest">SALTAR</button>
        </div>
      )}
    </div>
  );

  // ============================================================
  // RENDER: HOME (Mockup 1 + 2)
  // ============================================================
  const renderHome = () => (
    <div className="max-w-md mx-auto relative min-h-screen flex flex-col overflow-hidden pb-28">
      <div className="led-strip-top"></div>
      {/* Ambient Lights */}
      <div className="absolute top-[-10%] left-[-20%] w-80 h-80 bg-neon-purple opacity-20 blur-[100px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[20%] right-[-20%] w-80 h-80 bg-primary opacity-10 blur-[100px] rounded-full pointer-events-none"></div>

      {/* Header */}
      <header className="relative pt-6 px-4 z-10 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <img src={LOGO} className="w-10 h-10 drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]" />
          <div>
            <h1 className="font-display text-xl tracking-widest text-primary drop-shadow-md leading-none">GRAN RIFA</h1>
            <p className="text-[9px] tracking-[0.2em] text-primary/60 uppercase">Premium Edition</p>
          </div>
        </div>
        <div className="flex gap-3">
          {!isClientMode && (
            <>
              <button onClick={() => setShowLogin('ADMIN')} className="w-10 h-10 rounded-full glass flex items-center justify-center"><span className="material-icons-round text-white text-xl">settings</span></button>
              <button onClick={() => setShowLogin('SELLER')} className="w-10 h-10 rounded-full glass flex items-center justify-center"><span className="material-icons-round text-white text-xl">person</span></button>
            </>
          )}
        </div>
      </header>

      {/* Ticker */}
      <div className="ticker-wrap mt-4 py-1 z-10">
        <div className="ticker flex gap-8 items-center">
          <span className="text-[10px] text-primary flex items-center gap-1"><span className="material-icons-round text-[12px]">campaign</span> {config.tickerMessage || '¡La suerte te espera hoy!'}</span>
          <span className="text-[10px] text-primary flex items-center gap-1"><span className="material-icons-round text-[12px]">stars</span> {config.drawTitle} - ${config.ticketPriceUsd} por número</span>
          <span className="text-[10px] text-primary flex items-center gap-1"><span className="material-icons-round text-[12px]">diamond</span> {config.prizes?.[0]?.name || 'Premio'}</span>
        </div>
      </div>

      {/* Winner Banner */}
      {(config.winners?.length || 0) > 0 && (
        <div className="mx-4 mt-3 glass rounded-2xl border border-primary/30 p-4 flex items-center gap-3 z-10 shadow-gold-glow cursor-pointer" onClick={() => setView('TALONARIO')}>
          <div className="w-12 h-12 rounded-xl gold-gradient flex items-center justify-center shrink-0"><span className="material-icons-round text-black text-2xl">emoji_events</span></div>
          <div className="flex-1">
            <p className="text-[9px] text-primary uppercase font-bold tracking-widest">Último Ganador</p>
            <p className="text-white font-bold">#{config.winners[config.winners.length - 1].number} - {config.winners[config.winners.length - 1].name}</p>
            <p className="text-[10px] text-primary/60">{config.winners[config.winners.length - 1].prize}</p>
          </div>
          <span className="material-icons-round text-primary/40">chevron_right</span>
        </div>
      )}

      {/* Main Content */}
      <main className="relative z-10 px-4 mt-6 flex-1">
        {/* Prize Card */}
        <div className="relative flex flex-col items-center">
          <div className="w-full rounded-3xl overflow-hidden border border-primary/20 shadow-gold-glow relative aspect-video">
            <img src={config.prizes?.[0]?.image || "https://images.unsplash.com/photo-1696446701796-da61225697cc?q=80&w=1000&auto=format"} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 p-5">
              <span className="bg-primary text-black text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider">Premio Mayor</span>
              <h2 className="font-display text-3xl text-white mt-2 leading-tight">{config.prizes?.[0]?.name || 'Gran Premio'}</h2>
              <p className="text-sm text-primary/80 mt-1">{config.prizes?.[0]?.subtitle || 'Cargando detalles...'}</p>
            </div>
          </div>

          {/* Price Bar */}
          <div className="mt-4 w-full glass rounded-3xl p-1 flex items-center justify-between overflow-hidden shadow-gold-glow">
            <div className="px-6 py-2">
              <p className="text-white font-bold text-xl">${config.ticketPriceUsd} por número</p>
              <p className="text-primary text-xs font-medium">Bs. {config.ticketPriceLocal}</p>
            </div>
            <button onClick={() => setView('TALONARIO')} className="gold-gradient text-black font-bold h-full px-8 py-4 rounded-2xl flex flex-col items-center justify-center">
              <span className="text-sm">¡PARTICIPA YA!</span>
              <span className="text-[10px] opacity-80 font-normal">ELEGIR NÚMEROS</span>
            </button>
          </div>

          {/* Tickets Remaining */}
          <div className="w-full mt-4 px-2 flex justify-between items-end">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest">TICKETS RESTANTES: <span className="text-white">{ticketStats.available} / {tickets.length}</span></p>
          </div>
        </div>

        {/* Secondary Prizes */}
        <div className="mt-8 space-y-3">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-[0.2em] mb-4">Otros Premios</h3>
          {config.prizes?.slice(1).map((p, i) => (
            <div key={p.id} className="glass-dark p-4 rounded-2xl flex items-center gap-4">
              <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${i === 0 ? 'from-green-500/20 border-green-500/30' : 'from-accent-purple/20 border-accent-purple/30'} to-transparent flex items-center justify-center border shrink-0 overflow-hidden`}>
                {p.image ? <img src={p.image} className="w-full h-full object-cover rounded-xl" /> : <span className={`material-icons-round ${i === 0 ? 'text-green-400' : 'text-accent-purple'}`}>{i === 0 ? 'watch' : 'sports_esports'}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate">{p.name}</p>
                <p className="text-[10px] text-primary/70">{p.subtitle}</p>
              </div>
              <button onClick={() => setView('TALONARIO')} className="gold-gradient text-black font-bold text-[10px] px-4 py-2 rounded-xl uppercase tracking-wider shrink-0 active:scale-95 transition-all shadow-gold-glow">
                Participar
              </button>
            </div>
          ))}
        </div>

        {/* Countdown */}
        <div className="mt-8 glass p-5 rounded-2xl border border-primary/20 bg-primary/5 text-center">
          <p className="text-[8px] text-primary uppercase font-bold tracking-widest mb-3">PRÓXIMO SORTEO</p>
          {countdown.expired ? (
            <p className="font-digital text-lg text-accent-emerald animate-pulse">¡SORTEO EN CURSO!</p>
          ) : (
            <div className="flex justify-center gap-3">
              {[
                { val: countdown.days, label: 'DÍAS' },
                { val: countdown.hours, label: 'HRS' },
                { val: countdown.mins, label: 'MIN' },
                { val: countdown.secs, label: 'SEG' }
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div className="bg-black/60 border border-primary/20 rounded-xl px-3 py-2 min-w-[50px]">
                    <span className="font-digital text-2xl text-white">{item.val.toString().padStart(2, '0')}</span>
                  </div>
                  <span className="text-[8px] text-primary/60 uppercase font-bold mt-1 tracking-wider">{item.label}</span>
                  {i < 3 && <span className="hidden">:</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[9px] text-white/30 mt-3">{config.drawTimestamp ? new Date(config.drawTimestamp).toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Fecha no configurada'}</p>
        </div>

        {/* Reserve Button */}
        <button onClick={() => setView('TALONARIO')} className="w-full mt-6 py-4 rounded-2xl glass border-primary/40 text-primary font-bold tracking-widest uppercase text-xs flex items-center justify-center gap-2 shadow-lg">
          <span className="material-icons-round text-sm">confirmation_number</span> Reservar Números
        </button>

        {/* Affiliate CTA Home */}
        <section className="mt-12 mb-20">
          <div className="glass p-8 rounded-[40px] border border-white/5 text-center relative overflow-hidden group active:scale-95 transition-all cursor-pointer" onClick={() => setShowAffiliateModal(true)}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent-purple/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-accent-purple/20 transition-colors"></div>
            <span className="material-icons-round text-primary text-4xl mb-4">rocket_launch</span>
            <h3 className="text-xl font-bold text-white mb-2 italic uppercase">Genera Comisiones</h3>
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-[0.2em] leading-relaxed">Conviértete en afiliador hoy mismo<br />y vende desde tu celular</p>
          </div>
        </section>
      </main>

      {/* WhatsApp FAB */}
      <div className="fixed bottom-28 right-4 z-20">
        <button onClick={() => window.open(`https://wa.me/${config.whatsapp}`, '_blank')} className="bg-[#25D366] text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center">
          <span className="material-icons-round text-3xl">chat</span>
        </button>
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto glass border-t border-primary/20 px-8 py-4 flex justify-between items-center z-30">
        <button onClick={() => setView('HOME')} className="flex flex-col items-center gap-1"><span className="material-icons-round text-primary">style</span><span className="text-[10px] text-primary uppercase font-medium">Talonario</span></button>
        {!isClientMode && <button onClick={() => setShowLogin('SELLER')} className="flex flex-col items-center gap-1"><span className="material-icons-round text-gray-500">groups</span><span className="text-[10px] text-gray-500 uppercase font-medium">Ventas</span></button>}
        {!isClientMode && <button onClick={() => setShowLogin('ADMIN')} className="flex flex-col items-center gap-1"><span className="material-icons-round text-gray-500">settings</span><span className="text-[10px] text-gray-500 uppercase font-medium">Admin</span></button>}
      </nav>
    </div>
  );

  // ============================================================
  // RENDER: TALONARIO (Mockup 2: Modern Ticket Grid)
  // ============================================================
  const renderTalonario = () => (
    <div className="max-w-md mx-auto min-h-screen relative overflow-hidden flex flex-col" style={{ background: 'radial-gradient(circle at top right, #2D1B4D 0%, #0A0A0B 60%)' }}>
      <div className="led-strip-top"></div>
      <header className="p-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <img src={LOGO} className="w-10 h-10 drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]" />
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-primary leading-none">GRAN RIFA</h1>
            <p className="text-[9px] tracking-[0.2em] uppercase font-bold text-gray-400">Premium Edition</p>
          </div>
        </div>
        <button onClick={() => setView('HOME')} className="w-10 h-10 rounded-full glass-dark flex items-center justify-center"><span className="material-icons-round text-white text-xl">home</span></button>
      </header>

      {/* Ticker */}
      <div className="w-full bg-black/40 border-y border-white/5 py-1.5 overflow-hidden">
        <div className="ticker flex gap-8 items-center text-[10px] font-medium text-primary/80">
          <span className="flex items-center gap-1"><span className="material-icons-round text-xs">campaign</span> {config.tickerMessage || '¡La suerte te espera hoy!'}</span>
          <span className="flex items-center gap-1"><span className="material-icons-round text-xs">stars</span> {config.prizes[0]?.name} - ¡Participa ya!</span>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto scrollbar-hide pb-44 px-4 pt-6">
        {/* Prize Mini */}
        <div className="relative flex flex-col items-center mb-8">
          <div className="absolute w-48 h-48 bg-primary/20 rounded-full blur-[80px] -z-10"></div>
          <div className="relative w-40 h-40 mb-4">
            <div className="absolute inset-0 border-2 border-primary/40 rounded-full animate-spin" style={{ animationDuration: '8s' }}></div>
            <div className="absolute inset-2 border border-accent-purple/30 rounded-full"></div>
            <div className="relative w-full h-full p-4 flex items-center justify-center">
              <img src={config.prizes?.[0]?.image || "https://images.unsplash.com/photo-1695048133142-1a20484d2569"} className="w-full h-full object-contain drop-shadow-[0_0_20px_rgba(212,175,55,0.4)] rounded-2xl" />
            </div>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Premio Mayor</p>
          <h2 className="font-display text-2xl text-white">{config.prizes?.[0]?.name || 'Gran Premio'}</h2>
        </div>

        {/* Info Bar */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Tickets</span>
            <span className="bg-accent-purple/20 text-accent-purple text-[10px] px-2 py-0.5 rounded-full font-bold">{ticketStats.available} / {tickets.length}</span>
          </div>
        </div>

        {/* GRID DE NÚMEROS */}
        <div className="grid grid-cols-5 gap-2.5">
          {tickets.map(t => {
            const isSelected = selection.includes(t.id);
            const isOccupied = t.status !== 'AVAILABLE';
            return (
              <button
                key={t.id}
                onClick={() => {
                  if (isAdmin || isSeller) {
                    if (isOccupied) setSelectedTicketId(t.id);
                    else setSelection(p => isSelected ? p.filter(x => x !== t.id) : [...p, t.id]);
                  } else {
                    if (!isOccupied) setSelection(p => isSelected ? p.filter(x => x !== t.id) : [...p, t.id]);
                  }
                }}
                className={`rounded-xl h-14 flex flex-col items-center justify-center transition-all duration-200 ${isOccupied
                  ? (isAdmin || isSeller) ? 'bg-primary/20 border border-primary/40' : 'bg-black/40 border border-white/5 opacity-40 cursor-not-allowed'
                  : isSelected
                    ? 'glass-dark neon-purple-glow'
                    : 'glass-dark border border-white/5 opacity-80 hover:border-primary/40'
                  }`}
              >
                <span className={`text-xs font-bold ${isOccupied ? (isAdmin || isSeller) ? 'text-primary' : 'text-gray-600 line-through' : isSelected ? 'text-primary' : 'text-white'}`}>{t.id}</span>
                <span className={`text-[8px] uppercase font-bold ${(isAdmin || isSeller) && isOccupied ? 'text-primary/60' : isOccupied ? 'text-gray-700' : isSelected ? 'text-accent-purple' : 'text-gray-500'}`}>
                  {isOccupied ? (isAdmin || isSeller) ? 'Detalle' : 'Vendido' : isSelected ? 'Tuyo' : 'Libre'}
                </span>
              </button>
            );
          })}
        </div>

        {/* ZAZ Message */}
        {selection.length > 0 && (
          <div className="px-4 mt-8">
            <div className="inline-flex items-center gap-2 bg-accent-purple/20 px-4 py-2 rounded-full border border-accent-purple/30 shadow-neon-p">
              <span className="material-icons-round text-sm text-accent-purple">diamond</span>
              <span className="text-[11px] font-bold uppercase tracking-wide text-white">¡ZAZ! {selection.length} número(s) seleccionado(s)</span>
            </div>
          </div>
        )}

        {/* Affiliate CTA */}
        <div className="mt-12 px-2 pb-10">
          <div className="glass p-8 rounded-[40px] border border-primary/20 text-center relative overflow-hidden group active:scale-95 transition-all cursor-pointer" onClick={() => setShowAffiliateModal(true)}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-primary/20 transition-colors"></div>
            <span className="material-icons-round text-primary text-4xl mb-4">monetization_on</span>
            <h3 className="text-xl font-bold text-white mb-2 italic">¿QUIERES GANAR VENDIENDO?</h3>
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-[0.2em] leading-relaxed">Únete a nuestro equipo de distribuidores<br />y genera comisiones por cada ticket</p>
            <div className="mt-6 inline-flex items-center gap-2 text-primary font-bold text-[10px] uppercase tracking-widest border-b border-primary/30 pb-1">
              Saber más <span className="material-icons-round text-xs">arrow_forward</span>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Reserve */}
      <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto z-20">
        <div className="px-6 pb-6">
          <button
            onClick={() => selection.length > 0 && setShowCheckout(true)}
            disabled={selection.length === 0}
            className="w-full gold-gradient text-black font-extrabold py-4 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.4)] flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-30"
          >
            <span className="material-icons-round">local_activity</span>
            RESERVAR NÚMEROS ({selection.length})
          </button>
        </div>
        <nav className="bg-black/90 backdrop-blur-xl border-t border-white/5 px-8 pt-3 pb-8 flex justify-between items-center">
          <button onClick={() => setView('TALONARIO')} className="flex flex-col items-center gap-1"><span className="material-icons-round text-primary">confirmation_number</span><span className="text-[9px] uppercase tracking-tighter text-primary font-bold">Talonario</span></button>
          <button onClick={() => setView('HOME')} className="flex flex-col items-center gap-1 opacity-50"><span className="material-icons-round text-white">home</span><span className="text-[9px] uppercase tracking-tighter text-white font-bold">Inicio</span></button>
        </nav>
      </div>
    </div>
  );

  // ============================================================
  // RENDER: ADMIN (Mockup 3: Admin Dashboard)
  // ============================================================
  const renderAdmin = () => (
    <div className="min-h-screen pb-32" style={{ background: 'radial-gradient(circle at top right, #1a1a2e, #0a0a0c)' }}>
      <div className="led-strip-top"></div>
      {/* Header */}
      <header className="sticky top-0 z-50 glass border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src={LOGO} className="w-9 h-9 drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]" />
          <div>
            <h1 className="font-display text-primary text-lg leading-none tracking-wider">GRAN RIFA</h1>
            <p className="text-[10px] tracking-[0.2em] text-white/60 font-medium">ADMIN PANEL</p>
          </div>
        </div>
        <button onClick={() => setView('HOME')} className="w-10 h-10 rounded-full glass flex items-center justify-center border border-white/10"><span className="material-icons-round text-white">close</span></button>
      </header>

      {/* Tabs */}
      <div className="px-6 pt-6 pb-2 flex gap-2">
        {(['CONFIG', 'SELLERS', 'VENTAS'] as const).map(tab => (
          <button key={tab} onClick={() => setAdminTab(tab)} className={`flex-1 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${adminTab === tab ? 'glass neon-border-gold text-primary' : 'text-white/30'}`}>{tab === 'CONFIG' ? 'Ajustes' : tab === 'SELLERS' ? 'Vendedores' : 'Ventas'}</button>
        ))}
      </div>

      <main className="p-6 space-y-6">
        {/* ===== CONFIG TAB ===== */}
        {adminTab === 'CONFIG' && (
          <div className="space-y-6">
            <div className="flex items-center gap-2"><span className="material-icons-round text-primary/70">settings</span><h2 className="text-xl font-bold tracking-tight">Configuración Global</h2></div>

            <div className="glass p-5 rounded-3xl space-y-5 border-white/5">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Título del Sorteo</label>
                <input value={config.drawTitle} onChange={e => setConfig({ ...config, drawTitle: e.target.value })} className="casino-input neon-border-gold" />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">WhatsApp de Pago</label>
                <input value={config.whatsapp} onChange={e => setConfig({ ...config, whatsapp: e.target.value })} className="casino-input neon-border-gold" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Precio USD</label>
                  <input type="number" value={config.ticketPriceUsd} onChange={e => setConfig({ ...config, ticketPriceUsd: parseFloat(e.target.value) || 0 })} className="casino-input neon-border-gold" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Precio Bs</label>
                  <input type="number" value={config.ticketPriceLocal} onChange={e => setConfig({ ...config, ticketPriceLocal: parseFloat(e.target.value) || 0 })} className="casino-input neon-border-gold" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Fecha del Sorteo</label>
                <input type="datetime-local" value={config.drawTimestamp} onChange={e => setConfig({ ...config, drawTimestamp: e.target.value })} className="casino-input neon-border-gold" />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">% Comisión por Número Vendido</label>
                <div className="relative">
                  <input type="number" min="0" max="100" value={config.commissionPct} onChange={e => setConfig({ ...config, commissionPct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })} className="casino-input neon-border-gold" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-primary/60 font-bold">%</span>
                </div>
                <p className="text-[10px] text-white/30 ml-1">Porcentaje que gana el vendedor por cada número vendido</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Mensaje de Marquesina</label>
                <input value={config.tickerMessage} onChange={e => setConfig({ ...config, tickerMessage: e.target.value })} className="casino-input neon-border-gold" placeholder="Escribe el mensaje que se muestra en la marquesina..." />
                <p className="text-[10px] text-white/30 ml-1">Este texto aparece en la marquesina superior para todos los clientes</p>
              </div>
            </div>

            {/* Número Ganador */}
            <div className="glass p-5 rounded-3xl space-y-5 border border-primary/20">
              <div className="flex items-center gap-2"><span className="material-icons-round text-primary">emoji_events</span><h3 className="text-lg font-bold">Número Ganador</h3></div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">#Número</label>
                  <input id="winner-number" type="text" placeholder="00" className="casino-input neon-border-gold text-center font-bold text-lg" />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Premio</label>
                  <select id="winner-prize" className="casino-input neon-border-gold">
                    {config.prizes.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <button
                onClick={() => {
                  const num = (document.getElementById('winner-number') as HTMLInputElement).value.trim();
                  if (!num) { alert('Ingresa un número ganador'); return; }
                  const ticket = tickets.find(t => t.id === num);
                  const name = ticket?.participant?.name || prompt('Nombre del ganador:') || 'Sin nombre';
                  const prize = (document.getElementById('winner-prize') as HTMLSelectElement).value;
                  if (!confirm(`🏆 ¿Publicar #${num} (${name}) como ganador del ${prize}?`)) return;
                  updateConfigInSupabase({ ...config, winners: [...(config.winners || []), { number: num, name, date: new Date().toISOString(), prize }] });
                  (document.getElementById('winner-number') as HTMLInputElement).value = '';
                  alert(`🎉 ¡#${num} ha sido publicado como ganador!`);
                }}
                className="w-full gold-gradient text-black font-bold py-4 rounded-2xl flex items-center justify-center gap-2 active:scale-95 transition-all shadow-gold-glow text-sm uppercase tracking-widest"
              >
                <span className="material-icons-round">celebration</span>
                PUBLICAR GANADOR
              </button>

              {/* Historial Ganadores */}
              {(config.winners?.length || 0) > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <h4 className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Historial de Ganadores</h4>
                  {config.winners.map((w, i) => (
                    <div key={i} className="flex items-center justify-between bg-primary/5 p-3 rounded-xl border border-primary/10">
                      <div className="flex items-center gap-3">
                        <span className="material-icons-round text-primary">emoji_events</span>
                        <div>
                          <p className="text-sm font-bold text-white">#{w.number} - {w.name}</p>
                          <p className="text-[10px] text-primary/60">{w.prize} • {new Date(w.date).toLocaleDateString('es-VE')}</p>
                        </div>
                      </div>
                      <button onClick={() => updateConfigInSupabase({ ...config, winners: config.winners.filter((_, j) => j !== i) })} className="text-red-500/40 hover:text-red-500"><span className="material-icons-round text-sm">close</span></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Premio Mayor */}
            <div className="glass p-5 rounded-3xl space-y-5 border-white/5">
              <div className="flex items-center gap-2"><span className="material-icons-round text-accent-purple">stars</span><h3 className="text-lg font-bold">Premio Mayor</h3></div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Nombre del Premio</label>
                <div className="relative">
                  <input value={config.prizes[0].name} onChange={e => { const p = [...config.prizes]; p[0].name = e.target.value; setConfig({ ...config, prizes: p }); }} className="casino-input neon-border-purple casino-input-purple" />
                  <span className="material-icons-round absolute right-4 top-1/2 -translate-y-1/2 text-accent-purple">stars</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Subtítulo</label>
                <input value={config.prizes[0].subtitle} onChange={e => { const p = [...config.prizes]; p[0].subtitle = e.target.value; setConfig({ ...config, prizes: p }); }} className="casino-input neon-border-gold" />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">URL Imagen</label>
                <input value={config.prizes[0].image} onChange={e => { const p = [...config.prizes]; p[0].image = e.target.value; setConfig({ ...config, prizes: p }); }} className="casino-input neon-border-gold" />
              </div>
            </div>

            {/* Premios Secundarios */}
            {config.prizes.slice(1).map((pr, idx) => (
              <div key={pr.id} className="glass p-5 rounded-3xl space-y-4 border-white/5">
                <h3 className="text-sm font-bold text-primary/70 uppercase tracking-widest">{idx === 0 ? '2do' : '3er'} Premio</h3>
                <input value={pr.name} onChange={e => { const p = [...config.prizes]; p[idx + 1].name = e.target.value; setConfig({ ...config, prizes: p }); }} className="casino-input neon-border-gold" placeholder="Nombre" />
                <input value={pr.subtitle} onChange={e => { const p = [...config.prizes]; p[idx + 1].subtitle = e.target.value; setConfig({ ...config, prizes: p }); }} className="casino-input neon-border-gold" placeholder="Subtítulo" />
                <input value={pr.image} onChange={e => { const p = [...config.prizes]; p[idx + 1].image = e.target.value; setConfig({ ...config, prizes: p }); }} className="casino-input neon-border-gold" placeholder="URL Imagen" />
              </div>
            ))}

            {/* ===== TALONARIO CONFIG ===== */}
            <div className="glass p-5 rounded-3xl space-y-5 border-white/5">
              <div className="flex items-center gap-2"><span className="material-icons-round text-primary/70">grid_view</span><h3 className="text-lg font-bold">Configurar Talonario</h3></div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Cantidad de Números</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="10"
                    max="10000"
                    value={ticketCount}
                    onChange={e => setTicketCount(Math.max(10, Math.min(10000, parseInt(e.target.value) || 100)))}
                    className="casino-input neon-border-gold flex-1"
                  />
                  <button
                    onClick={() => regenerateTickets(ticketCount)}
                    className="bg-accent-purple text-white font-bold px-6 py-4 rounded-2xl text-xs uppercase tracking-widest shadow-neon-p active:scale-95 transition-all whitespace-nowrap"
                  >
                    Aplicar
                  </button>
                </div>
                <p className="text-[10px] text-white/30 ml-1">Mínimo 10, máximo 10,000. Los números vendidos se conservan.</p>
              </div>

              {/* Limpiar selección */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-white/50 ml-1 font-semibold">Selección Actual</label>
                <div className="flex items-center justify-between glass p-4 rounded-2xl border-white/5">
                  <div>
                    <p className="text-white font-bold">{selection.length} {selection.length === 1 ? 'número' : 'números'} seleccionados</p>
                    <p className="text-[10px] text-white/30">Números en espera de checkout</p>
                  </div>
                  <button
                    onClick={() => { setSelection([]); alert('✅ Selección limpiada'); }}
                    disabled={selection.length === 0}
                    className="bg-orange-500/20 text-orange-400 font-bold px-5 py-2.5 rounded-xl text-xs uppercase tracking-widest border border-orange-500/30 disabled:opacity-20 active:scale-95 transition-all"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            </div>

            {/* ===== ZONA PELIGROSA ===== */}
            <div className="glass p-5 rounded-3xl space-y-5 border border-red-500/20">
              <div className="flex items-center gap-2"><span className="material-icons-round text-red-500">warning</span><h3 className="text-lg font-bold text-red-400">Zona Peligrosa</h3></div>
              <p className="text-[11px] text-white/40 leading-relaxed">Estas acciones son irreversibles. Se te pedirá doble confirmación antes de ejecutarlas.</p>

              <button
                onClick={resetEverything}
                className="w-full bg-red-500/10 border border-red-500/30 text-red-400 font-bold py-4 rounded-2xl text-sm uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-red-500/20 active:scale-95 transition-all"
              >
                <span className="material-icons-round">restart_alt</span>
                REINICIAR TODO A CERO
              </button>
              <p className="text-[9px] text-red-500/40 text-center">Borra TODAS las ventas, reservas y selecciones. Mantiene la configuración y vendedores.</p>
            </div>
          </div>
        )}

        {/* ===== SELLERS TAB ===== */}
        {adminTab === 'SELLERS' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><span className="material-icons-round text-primary/70">groups</span><h2 className="text-xl font-bold tracking-tight">Gestión de Vendedores</h2></div>
              <span className="text-xs text-primary/60 font-bold">{sellers.length} vendedores</span>
            </div>

            <button onClick={() => {
              showSellerForm(async (name, pin) => {
                if (name && pin) await createSellerInSupabase(name, pin);
              });
            }} className="w-full glass p-4 rounded-2xl text-primary font-bold text-sm uppercase tracking-widest flex items-center justify-center gap-2 neon-border-gold">
              <span className="material-icons-round">add_circle</span> Nuevo Distribuidor
            </button>

            <div className="space-y-3">
              {sellers.map((s, idx) => {
                const sellerTickets = tickets.filter(t => t.sellerId === s.id && t.status !== 'AVAILABLE');
                const sSales = sellerTickets.length;
                const sTotal = sSales * config.ticketPriceUsd;
                const sCommission = sTotal * (config.commissionPct / 100);
                const pct = Math.min(100, Math.floor((sTotal / Math.max(tickets.length * config.ticketPriceUsd * 0.2, 1)) * 100));
                const colors = ['from-yellow-500/30 border-yellow-500/40 text-yellow-400', 'from-purple-500/30 border-purple-500/40 text-purple-400', 'from-emerald-500/30 border-emerald-500/40 text-emerald-400', 'from-pink-500/30 border-pink-500/40 text-pink-400', 'from-blue-500/30 border-blue-500/40 text-blue-400'];
                const colorClass = colors[idx % colors.length];
                return (
                  <div key={s.id} onClick={() => setSelectedSeller(s)} className="glass p-5 rounded-3xl border-white/5 flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-all hover:border-primary/20">
                    <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${colorClass} to-transparent flex items-center justify-center border shrink-0`}>
                      <span className="font-bold text-lg">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-white truncate">{s.name}</span>
                        <span className="text-sm font-bold text-primary ml-2 shrink-0">${sTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                        <div className="h-full gold-gradient rounded-full transition-all duration-1000" style={{ width: `${pct}%` }}></div>
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[9px] text-white/30">{sSales} ventas • Comisión: ${sCommission.toFixed(2)}</span>
                        <span className="material-icons-round text-[14px] text-white/20">chevron_right</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {sellers.length === 0 && <div className="text-center py-12 text-white/10 font-bold uppercase text-sm tracking-widest">Sin vendedores registrados</div>}
            </div>
          </div>
        )}

        {/* ===== VENTAS TAB ===== */}
        {adminTab === 'VENTAS' && (
          <div className="space-y-6">
            {/* Summary Card */}
            <div className="total-cash-card p-8 text-center border border-white/5">
              <p className="text-white/40 text-[10px] font-bold uppercase tracking-[0.3em] mb-2">Recaudación Verificada</p>
              <h2 className="text-5xl font-bold text-white">${ticketStats.totalPaid}</h2>
              <div className="flex justify-center gap-8 mt-6">
                <div><p className="text-white/40 text-[9px] uppercase font-bold">Pagados</p><p className="text-accent-emerald font-bold text-lg">{ticketStats.paid}</p></div>
                <div className="w-px h-10 bg-white/10"></div>
                <div><p className="text-white/40 text-[9px] uppercase font-bold">Pendientes</p><p className="text-orange-400 font-bold text-lg">{ticketStats.sold - ticketStats.paid}</p></div>
              </div>
            </div>

            {/* Ticket List */}
            <div className="space-y-3">
              {tickets.filter(t => t.status !== 'AVAILABLE').map(t => (
                <div key={t.id} onClick={() => setSelectedTicketId(t.id)} className="glass p-4 rounded-2xl flex items-center gap-3 border-white/5 cursor-pointer active:scale-95 transition-all">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center border font-bold text-sm shrink-0 ${t.status === 'PAGADO' ? 'bg-accent-emerald/20 border-accent-emerald/40 text-accent-emerald' : 'bg-orange-500/20 border-orange-500/40 text-orange-400'}`}>
                    {t.id}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-white text-sm truncate">{t.participant?.name || 'Sin nombre'}</h4>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ml-1 shrink-0 ${t.status === 'PAGADO' ? 'bg-accent-emerald/10 text-accent-emerald border border-accent-emerald/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                        {t.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}
                      </span>
                    </div>
                    <p className="text-[10px] text-white/30 mt-0.5">{t.participant?.phone || ''} • ${config.ticketPriceUsd}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {t.participant?.phone && (
                      <button onClick={() => {
                        const dateStr = config.drawTimestamp ? new Date(config.drawTimestamp).toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Pendiente';
                        const statusMsg = t.status === 'PAGADO' ? '✅ PAGADO - ¡Mucha Suerte!' : '⏳ PENDIENTE DE PAGO';
                        const msg = `🎫 *COMPROBANTE DE RESERVA* 🎫\n*${config.drawTitle}*\n\nHola *${t.participant!.name}* 👋\n\nTe informamos el estado de tu participación:\n🎟️ Número: *#${t.id}*\n📊 Estado: ${statusMsg}\n\n📅 Sorteo: ${dateStr}\n💰 Precio: $${config.ticketPriceUsd}\n\n⚠️ Recuerda que para ganar, el boleto debe estar pagado antes del sorteo.`;
                        window.open(`https://wa.me/${t.participant!.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
                      }} className="w-8 h-8 rounded-lg bg-[#25D366]/20 flex items-center justify-center"><span className="material-icons-round text-[#25D366] text-sm">message</span></button>
                    )}
                    {t.status === 'REVISANDO' && (
                      <button onClick={() => updateTicketInSupabase(t.id, { status: 'PAGADO' })} className="w-8 h-8 rounded-lg bg-accent-emerald/20 flex items-center justify-center"><span className="material-icons-round text-accent-emerald text-sm">check</span></button>
                    )}
                    <button onClick={() => updateTicketInSupabase(t.id, { status: 'AVAILABLE', participant: undefined, seller_id: undefined } as any)} className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center"><span className="material-icons-round text-red-500/50 text-sm">close</span></button>
                  </div>
                </div>
              ))}
              {ticketStats.sold === 0 && <div className="text-center py-16 text-white/10 font-bold uppercase text-sm tracking-widest">Sin ventas registradas</div>}
            </div>
          </div>
        )}
      </main>

      {/* Save Button */}
      <div className="fixed bottom-10 left-0 right-0 px-6 flex justify-center z-50">
        <button
          onClick={() => {
            updateConfigInSupabase(config);
            showAlert("ÉXITO", "Configuración guardada correctamente.");
          }}
          className="bg-accent-emerald text-black font-bold py-4 px-12 rounded-full flex items-center gap-3 neon-emerald hover:scale-105 transition-transform active:scale-95 shadow-[0_0_30px_rgba(16,185,129,0.4)]"
        >
          <span className="material-icons-round">save</span> GUARDAR CAMBIOS
        </button>
      </div>
    </div>
  );

  // ============================================================
  // RENDER: SELLER HUB (Mockup 4: Seller Dashboard)
  // ============================================================
  const renderSellerHub = () => (
    <div className="min-h-screen pb-32" style={{ background: '#0B0E14' }}>
      <div className="led-strip-top"></div>
      {/* Ambient */}
      <div className="fixed top-[-100px] right-[-100px] w-80 h-80 bg-accent-purple/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed bottom-[-100px] left-[-100px] w-80 h-80 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>

      <header className="sticky top-0 z-50 px-6 py-4 flex justify-between items-center glass border-b border-white/10">
        <div className="flex items-center gap-3">
          <img src={LOGO} className="w-9 h-9 drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]" />
          <div className="flex flex-col">
            <h1 className="font-display text-lg leading-tight tracking-widest font-bold text-primary">GRAN RIFA</h1>
            <span className="text-[10px] uppercase tracking-[0.3em] -mt-1 font-semibold text-white/60">Portal Vendedor</span>
          </div>
        </div>
        <button onClick={() => { setCurrentSeller(null); setView('HOME'); }} className="w-10 h-10 rounded-full glass flex items-center justify-center"><span className="material-icons-round text-white">logout</span></button>
      </header>

      <main className="px-6 py-8 max-w-md mx-auto space-y-8">
        {/* Radial Progress */}
        <section className="relative radial-progress-container rounded-3xl py-10 flex flex-col items-center justify-center">
          <div className="relative w-48 h-48 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 192 192">
              <circle cx="96" cy="96" r="88" stroke="rgba(255,255,255,0.05)" strokeWidth="12" fill="transparent" />
              <circle cx="96" cy="96" r="88" stroke="url(#sellerGrad)" strokeWidth="12" fill="transparent" strokeDasharray={2 * Math.PI * 88} strokeDashoffset={2 * Math.PI * 88 * (1 - (sellerStats.count / Math.max(tickets.length * 0.2, 1)))} strokeLinecap="round" className="drop-shadow-[0_0_12px_rgba(168,85,247,0.8)]" />
              <defs><linearGradient id="sellerGrad" x1="0%" x2="100%"><stop offset="0%" stopColor="#A855F7" /><stop offset="100%" stopColor="#EAB308" /></linearGradient></defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-white/60 text-sm uppercase tracking-wider font-semibold">Meta de Ventas</span>
              <span className="text-4xl font-extrabold text-white mt-1">{Math.min(100, Math.floor((sellerStats.totalSales / 1000) * 100))}%</span>
              <span className="text-primary text-xs font-bold mt-1">{sellerStats.count} / {Math.max(Math.floor(tickets.length * 0.2), 10)} Tickets</span>
            </div>
          </div>
          <div className="flex-1 text-center font-serif">
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-tighter">Comisión ({sellerStats.ratePct}%)</p>
            <p className="text-2xl font-bold text-accent-emerald">${sellerStats.commission.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="w-px h-10 bg-white/10"></div>
          <div className="flex-1 text-center font-serif">
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-tighter">Total Ventas</p>
            <p className="text-2xl font-bold text-primary">${sellerStats.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          </div>
        </section>

        {/* Referral Link */}
        <section className="space-y-4">
          <h3 className="text-white/80 text-sm font-bold uppercase tracking-widest flex items-center gap-2"><span className="material-icons-round text-xs">link</span> Mi Link de Referido</h3>
          <div className="glass p-5 rounded-2xl flex items-center justify-between border-white/5 neon-gold-glow">
            <div className="overflow-hidden flex-1 mr-4">
              <p className="text-white/50 text-xs mb-1">Link Único</p>
              <p className="text-white font-medium truncate text-sm">{window.location.origin}?ref={currentSeller?.id}</p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?ref=${currentSeller?.id}`); showAlert("COPIADO", "¡Link de referido copiado!"); }} className="bg-primary hover:bg-yellow-500 transition-colors text-black px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 shrink-0">
              <span className="material-icons-round text-lg">content_copy</span> Copiar
            </button>
          </div>
        </section>

        {/* Sales List */}
        <section className="space-y-4">
          <div className="flex justify-between items-end"><h3 className="text-white/80 text-sm font-bold uppercase tracking-widest">Mis Ventas</h3></div>
          <div className="space-y-3">
            {tickets.filter(t => t.sellerId === currentSeller?.id && t.status !== 'AVAILABLE').map(t => (
              <div key={t.id} onClick={() => setSelectedTicketId(t.id)} className="glass p-4 rounded-2xl flex items-center gap-4 active:scale-95 transition-transform border-white/5 cursor-pointer">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border font-bold shadow-lg ${t.status === 'PAGADO' ? 'bg-accent-emerald/20 border-accent-emerald/40 text-accent-emerald' : 'bg-orange-500/20 border-orange-500/40 text-orange-500'}`}>
                  {t.id}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between">
                    <h4 className="font-bold text-white text-sm">{t.participant?.name}</h4>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${t.status === 'PAGADO' ? 'bg-accent-emerald/10 text-accent-emerald border border-accent-emerald/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                      {t.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}
                    </span>
                  </div>
                  <p className="text-xs text-white/40 mt-1">${config.ticketPriceUsd} • #{t.id}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {t.participant?.phone && (
                    <button onClick={(e) => {
                      e.stopPropagation();
                      const dateStr = config.drawTimestamp ? new Date(config.drawTimestamp).toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Pendiente';
                      const statusMsg = t.status === 'PAGADO' ? '✅ PAGADO - ¡Mucha Suerte!' : '⏳ PENDIENTE DE PAGO';
                      const msg = `🎫 *COMPROBANTE* 🎫\n*${config.drawTitle}*\n\nHola *${t.participant!.name}* 👋\n\n🎟️ Número: *#${t.id}*\n📊 Estado: ${statusMsg}\n\n💰 Total: $${config.ticketPriceUsd}\n\nGracias por participar. 🙏`;
                      window.open(`https://wa.me/${t.participant!.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
                    }} className="w-9 h-9 rounded-xl bg-[#25D366]/10 flex items-center justify-center border border-[#25D366]/20 transition-all active:scale-90"><span className="material-icons-round text-[#25D366] text-base">message</span></button>
                  )}

                  {t.status === 'REVISANDO' && (
                    <button onClick={() => { showConfirm('✅ CONFIRMAR PAGO', `¿Confirmar pago del #${t.id}?`, () => updateTicketInSupabase(t.id, { status: 'PAGADO' })); }} className="w-9 h-9 rounded-xl bg-accent-emerald/10 flex items-center justify-center border border-accent-emerald/20 transition-all active:scale-90"><span className="material-icons-round text-accent-emerald text-base">check</span></button>
                  )}

                  <button onClick={() => { showConfirm('❌ CANCELAR', `¿Liberar el número #${t.id}?`, () => updateTicketInSupabase(t.id, { status: 'AVAILABLE', participant: undefined, seller_id: undefined } as any)); }} className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20 transition-all active:scale-90"><span className="material-icons-round text-red-500/60 text-base">close</span></button>
                </div>
              </div>
            ))}
            {sellerStats.count === 0 && <div className="text-center py-16 text-white/10 font-bold uppercase text-sm tracking-widest">Sin ventas aún</div>}
          </div>
        </section>

        {/* Affiliate CTA Seller (Encouragement) */}
        <section className="mt-12 pb-32">
          <div className="glass p-8 rounded-[40px] border border-accent-emerald/10 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-32 h-32 bg-accent-emerald/5 rounded-full blur-3xl -ml-16 -mt-16"></div>
            <span className="material-icons-round text-accent-emerald text-4xl mb-4">stars</span>
            <h3 className="text-xl font-bold text-white mb-2 italic uppercase tracking-tighter">¡Sigue Ganando!</h3>
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-[0.2em] leading-relaxed">Cada venta te acerca a tus metas.<br />Tu comisión actual es del {sellerStats.ratePct}%</p>
          </div>
        </section>
      </main>
    </div>
  );

  const renderAffiliateModal = () => (
    <div className="fixed inset-0 z-[10005] flex items-center justify-center p-6 glass-heavy backdrop-blur-3xl animate-fade-in text-white overflow-y-auto">
      <div className="bg-[#0c0c0c] w-full max-w-sm rounded-[40px] border border-white/10 shadow-2xl overflow-hidden animate-scale-up my-auto">
        <div className="p-8 text-center bg-primary/10 relative border-b border-white/5">
          <button onClick={() => setShowAffiliateModal(false)} className="absolute top-6 right-6 text-white/30 hover:text-white transition-colors"><span className="material-icons-round">close</span></button>
          <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/20 text-primary flex items-center justify-center mb-4 border border-primary/30">
            <span className="material-icons-round text-3xl">rocket_launch</span>
          </div>
          <h3 className="text-xl font-bold tracking-widest uppercase italic">Únete al Equipo</h3>
          <p className="text-[10px] text-white/40 uppercase font-bold mt-2 tracking-[0.2em]">Gana comisiones desde tu celular</p>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          createApplicationInSupabase({
            full_name: fd.get('name') as string,
            id_number: fd.get('cedula') as string,
            phone: fd.get('phone') as string,
            family_phone: fd.get('fphone') as string,
            address: fd.get('address') as string,
          });
        }} className="p-8 space-y-4">
          <div className="space-y-4">
            <input name="name" required placeholder="NOMBRE COMPLETO" className="casino-input w-full uppercase text-xs" />
            <input name="cedula" required placeholder="CÉDULA / ID" className="casino-input w-full uppercase text-xs" />
            <input name="address" required placeholder="DIRECCIÓN EXACTA" className="casino-input w-full uppercase text-xs" />
            <input name="phone" required placeholder="TU WHATSAPP" className="casino-input w-full text-xs" />
            <input name="fphone" required placeholder="TELÉFONO DE FAMILIAR" className="casino-input w-full text-xs" />
          </div>

          <div className="bg-primary/5 p-4 rounded-2xl border border-primary/10">
            <p className="text-[9px] text-primary/60 leading-relaxed text-center font-bold uppercase tracking-wider">⚠️ Ten a la mano foto de tu cédula y un recibo para la validación final vía WhatsApp.</p>
          </div>

          <button type="submit" className="w-full py-5 rounded-2xl gold-gradient text-black font-extrabold uppercase tracking-widest text-xs shadow-gold-glow mt-2 active:scale-95 transition-all">
            ENVIAR SOLICITUD
          </button>
        </form>
      </div>
    </div>
  );

  // ============================================================
  // MAIN RENDER
  // ============================================================
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[10000] bg-[#0A0A0B] flex flex-col items-center justify-center p-10 text-center animate-fade-in">
        <div className="relative w-48 h-48 mb-10">
          <div className="absolute inset-0 border-2 border-primary/20 rounded-full animate-ping"></div>
          <div className="absolute inset-[-10px] border border-accent-purple/10 rounded-full animate-spin" style={{ animationDuration: '3s' }}></div>
          <img src={LOGO} className="w-full h-full object-contain drop-shadow-gold-glow animate-pulse scale-110" />
        </div>
        <div className="space-y-3">
          <h3 className="text-primary font-bold uppercase tracking-[0.5em] text-[12px] animate-pulse">Procesando Fortuna</h3>
          <p className="text-white/20 text-[9px] uppercase tracking-[0.3em] font-medium italic">Sincronizando con el destino...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {splash !== 'DONE' && renderSplash()}
      {splash === 'DONE' && (
        <>
          {view === 'HOME' && renderHome()}
          {view === 'TALONARIO' && renderTalonario()}
          {view === 'ADMIN' && renderAdmin()}
          {view === 'SELLER_HUB' && renderSellerHub()}

          {showAffiliateModal && renderAffiliateModal()}

          {/* CHECKOUT MODAL */}
          {showCheckout && (
            <div className="fixed inset-0 z-[9000] bg-black/98 flex flex-col justify-end">
              <div className="bg-[#0c0c0c] w-full max-w-md mx-auto rounded-t-[50px] overflow-hidden border-t border-white/10 shadow-2xl">
                <div className="modal-header-green p-12 text-center relative">
                  <button onClick={() => setShowCheckout(false)} className="absolute top-6 right-6 text-white/30"><span className="material-icons-round">close</span></button>
                  <h2 className="text-3xl font-bold text-white uppercase tracking-tighter">Checkout VIP</h2>
                  <p className="text-[10px] text-primary uppercase tracking-[0.3em] font-bold mt-2">Confirma tu apuesta</p>
                </div>
                <div className="p-10 space-y-8 bg-black">
                  <input id="checkout-name" placeholder="NOMBRE COMPLETO" className="casino-input neon-border-gold w-full uppercase" />
                  <input id="checkout-phone" placeholder="WHATSAPP (+58...)" className="casino-input neon-border-gold w-full" />
                  <div className="glass p-6 rounded-3xl border border-white/10 text-center">
                    <div className="flex flex-wrap justify-center gap-2 mb-6">
                      {selection.map(num => <span key={num} className="bg-accent-purple/20 neon-purple-glow text-primary px-3 py-1 rounded-lg font-bold text-sm">{num}</span>)}
                    </div>
                    <div className="border-t border-white/10 pt-4 flex justify-between items-center">
                      <span className="text-white/50 text-sm font-bold uppercase">Total</span>
                      <span className="text-3xl font-bold text-primary">${selection.length * config.ticketPriceUsd}</span>
                    </div>
                  </div>
                  <button onClick={() => {
                    const n = (document.getElementById('checkout-name') as HTMLInputElement).value;
                    const p = (document.getElementById('checkout-phone') as HTMLInputElement).value;
                    if (n && p) {
                      const dateStr = config.drawTimestamp ? new Date(config.drawTimestamp).toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Pendiente';
                      const message = `🌟 *${config.drawTitle}* 🌟\n\n¡Hola! 👋 Mi nombre es *${n.toUpperCase()}*.\n\nHe reservado los siguientes números:\n🎟️ *${selection.join(', ')}*\n\n📅 *Fecha del Sorteo:* ${dateStr}\n💰 *Total a pagar:* $${selection.length * config.ticketPriceUsd}\n\n⚠️ *Condiciones:* Para participar y ganar, el boleto debe estar *PAGADO* antes del sorteo.\n\n¡Gracias! 🙏`;

                      setIsLoading(true);

                      // Validación Atómica antes de proceder
                      supabase.from('kerifa_tickets').select('id, status').in('id', selection).then(({ data: currentTickets }) => {
                        const taken = currentTickets?.filter(t => t.status !== 'AVAILABLE') || [];

                        if (taken.length > 0) {
                          alert(`⚠️ ¡Lo sentimos! Los números [${taken.map(t => t.id).join(', ')}] ya han sido vendidos o reservados por otra persona. Por favor elige otros.`);
                          setIsLoading(false);
                          setSelection([]);
                          return;
                        }

                        // Si están libres, procedemos
                        window.open(`https://wa.me/${config.whatsapp}?text=${encodeURIComponent(message)}`, '_blank');
                        const finalRef = referralId || '';

                        // 1. Actualización Optimista (UI instantánea)
                        const participantData = { name: n, phone: p, timestamp: Date.now() };
                        setTickets(prev => prev.map(t => selection.includes(t.id) ? { ...t, status: 'REVISANDO' as TicketStatus, participant: participantData, sellerId: finalRef || undefined } : t));

                        // 2. Enviar a Supabase
                        const updates: any = { status: 'REVISANDO', participant: participantData };
                        if (finalRef) updates.seller_id = finalRef;

                        supabase.from('kerifa_tickets').update(updates).in('id', selection).then(({ error }) => {
                          setIsLoading(false);
                          if (error) {
                            console.error("Error al reservar:", error);
                            showAlert("ERROR", "Hubo un error al guardar tu reserva. Por favor intenta de nuevo.");
                          } else {
                            setShowGoldenTicket({ show: true, numbers: [...selection] });
                          }
                          setSelection([]); setShowCheckout(false);
                        });
                      });
                    }
                  }} className="w-full gold-gradient text-black font-extrabold py-5 rounded-2xl shadow-gold-glow active:scale-95 transition-all text-lg uppercase tracking-widest flex items-center justify-center gap-2">
                    <span className="material-icons-round">check_circle</span> CONFIRMAR RESERVA
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SELLER DETAIL MODAL */}
          {selectedSeller && (() => {
            const st = tickets.filter(t => t.sellerId === selectedSeller.id && t.status !== 'AVAILABLE');
            const stPaid = st.filter(t => t.status === 'PAGADO');
            const stPending = st.filter(t => t.status === 'REVISANDO');
            const totalVentas = st.length * config.ticketPriceUsd;
            const comision = totalVentas * (config.commissionPct / 100);
            const dateStr = config.drawTimestamp ? new Date(config.drawTimestamp).toLocaleDateString('es-VE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Pendiente';
            const shareText = `📊 *REPORTE DE VENTAS - ${config.drawTitle}*\n\n👤 *Vendedor:* ${selectedSeller.name}\n🎟️ *Números vendidos:* ${st.length}\n✅ *Pagados:* ${stPaid.length}\n⏳ *Pendientes:* ${stPending.length}\n💰 *Monto Recaudado:* $${totalVentas.toFixed(2)}\n🏆 *Comisión (${config.commissionPct}%):* $${comision.toFixed(2)}\n\n📅 *Sorteo:* ${dateStr}\n\n📋 *DETALLE DE NÚMEROS:*\n${st.map(t => `• #${t.id} - ${t.participant?.name || 'N/A'} (${t.status === 'PAGADO' ? '✅ Pagado' : '⏳ Pendiente'})`).join('\n')}\n\n🌟 _Generado desde Gran Rifa Premium_`;

            return (
              <div className="fixed inset-0 z-[9200] bg-black/98 backdrop-blur-xl flex flex-col overflow-y-auto">
                <div className="max-w-md mx-auto w-full p-6 space-y-6">
                  {/* Header */}
                  <div className="flex items-center justify-between pt-4">
                    <button onClick={() => setSelectedSeller(null)} className="w-10 h-10 rounded-full glass flex items-center justify-center"><span className="material-icons-round text-white">arrow_back</span></button>
                    <h2 className="text-lg font-bold text-white uppercase tracking-widest">Perfil Vendedor</h2>
                    <div className="w-10"></div>
                  </div>

                  {/* Avatar + Name */}
                  <div className="flex flex-col items-center gap-4 py-6">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/30 to-accent-purple/30 flex items-center justify-center border-2 border-primary/40 shadow-gold-glow">
                      <span className="text-3xl font-bold text-primary">{selectedSeller.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="text-center">
                      <h3 className="text-2xl font-bold text-white">{selectedSeller.name}</h3>
                      <p className="text-xs text-white/30 mt-1">PIN: {selectedSeller.pin} • ID: {selectedSeller.id.slice(0, 8)}</p>
                    </div>
                  </div>

                  {/* Stats Cards */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass p-4 rounded-2xl text-center border-white/5">
                      <p className="text-2xl font-bold text-white">{st.length}</p>
                      <p className="text-[9px] text-white/40 uppercase font-bold tracking-wider mt-1">Vendidos</p>
                    </div>
                    <div className="glass p-4 rounded-2xl text-center border-white/5">
                      <p className="text-2xl font-bold text-primary">${totalVentas.toFixed(0)}</p>
                      <p className="text-[9px] text-white/40 uppercase font-bold tracking-wider mt-1">Total USD</p>
                    </div>
                    <div className="glass p-4 rounded-2xl text-center border-white/5">
                      <p className="text-2xl font-bold text-accent-emerald">${comision.toFixed(2)}</p>
                      <p className="text-[9px] text-white/40 uppercase font-bold tracking-wider mt-1">Comisión {config.commissionPct}%</p>
                    </div>
                  </div>

                  {/* Paid vs Pending */}
                  <div className="flex gap-3">
                    <div className="flex-1 glass p-3 rounded-xl border-white/5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent-emerald/20 flex items-center justify-center"><span className="material-icons-round text-accent-emerald text-lg">check_circle</span></div>
                      <div><p className="text-white font-bold">{stPaid.length}</p><p className="text-[9px] text-white/30 uppercase">Pagados</p></div>
                    </div>
                    <div className="flex-1 glass p-3 rounded-xl border-white/5 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center"><span className="material-icons-round text-orange-400 text-lg">schedule</span></div>
                      <div><p className="text-white font-bold">{stPending.length}</p><p className="text-[9px] text-white/30 uppercase">Pendientes</p></div>
                    </div>
                  </div>

                  {/* Share Button */}
                  <button
                    onClick={() => {
                      const encoded = encodeURIComponent(shareText);
                      window.open(`https://wa.me/${selectedSeller.pin.length > 4 ? selectedSeller.pin : ''}?text=${encoded}`, '_blank');
                    }}
                    className="w-full bg-[#25D366] text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all shadow-lg"
                  >
                    <span className="material-icons-round">share</span>
                    COMPARTIR REPORTE POR WHATSAPP
                  </button>

                  {/* Sold Numbers List */}
                  <div className="space-y-3">
                    <h4 className="text-xs text-white/50 uppercase tracking-widest font-bold flex items-center gap-2">
                      <span className="material-icons-round text-sm">confirmation_number</span>
                      Números Vendidos ({st.length})
                    </h4>
                    {st.length === 0 ? (
                      <div className="text-center py-12 text-white/10 font-bold uppercase text-sm tracking-widest">Sin ventas aún</div>
                    ) : (
                      st.map(t => (
                        <div key={t.id} className="glass p-4 rounded-2xl flex items-center gap-3 border-white/5">
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center border font-bold text-sm ${t.status === 'PAGADO' ? 'bg-accent-emerald/20 border-accent-emerald/40 text-accent-emerald' : 'bg-orange-500/20 border-orange-500/40 text-orange-400'}`}>
                            {t.id}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">{t.participant?.name || 'Sin nombre'}</p>
                            <p className="text-[10px] text-white/30">{t.participant?.phone || 'Sin teléfono'} • ${config.ticketPriceUsd}</p>
                          </div>
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${t.status === 'PAGADO' ? 'bg-accent-emerald/10 text-accent-emerald border border-accent-emerald/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                            {t.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Delete Seller */}
                  <button
                    onClick={() => {
                      const name = prompt(`Para eliminar a ${selectedSeller.name}, escribe su nombre exactamente:`);
                      if (name === selectedSeller.name) {
                        deleteSellerInSupabase(selectedSeller.id).then(() => setSelectedSeller(null));
                      } else if (name !== null) {
                        alert("El nombre no coincide. Eliminación cancelada.");
                      }
                    }}
                    className="w-full mt-12 py-4 text-red-500/50 hover:text-red-500 text-xs font-bold uppercase tracking-[0.3em] flex items-center justify-center gap-2 border border-red-500/10 rounded-2xl transition-all"
                  >
                    <span className="material-icons-round text-sm">delete</span> ELIMINAR VENDEDOR
                  </button>

                  <div className="h-10"></div>
                </div>
              </div>
            );
          })()}

          {/* WARNING MODAL - Reducir Talonario */}
          {warningModal.show && (
            <div className="fixed inset-0 z-[9300] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6">
              <div className="glass rounded-3xl border border-red-500/30 max-w-sm w-full overflow-hidden">
                <div className="bg-red-500/10 p-6 text-center border-b border-red-500/20">
                  <span className="material-icons-round text-red-400 text-5xl mb-3">warning</span>
                  <h3 className="text-xl font-bold text-white">¡Advertencia!</h3>
                  <p className="text-sm text-white/50 mt-2">No se puede reducir a <span className="text-red-400 font-bold">{warningModal.newCount}</span> números</p>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-white/60 leading-relaxed">
                    Hay <span className="text-red-400 font-bold">{warningModal.tickets.length}</span> {warningModal.tickets.length === 1 ? 'número vendido/reservado' : 'números vendidos/reservados'} fuera del nuevo rango que se {warningModal.tickets.length === 1 ? 'perdería' : 'perderían'}:
                  </p>
                  <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                    {warningModal.tickets.map(t => (
                      <div key={t.id} className="flex items-center justify-between bg-red-500/10 p-3 rounded-xl border border-red-500/15">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-white bg-red-500/20 px-2.5 py-1 rounded-lg text-sm">#{t.id}</span>
                          <span className="text-xs text-white/60">{t.participant?.name || 'Sin nombre'}</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.status === 'PAGADO' ? 'bg-accent-emerald/10 text-accent-emerald' : 'bg-orange-500/10 text-orange-400'}`}>
                          {t.status === 'PAGADO' ? 'Pagado' : 'Pendiente'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setWarningModal({ show: false, tickets: [], newCount: 0 })}
                      className="flex-1 glass text-white font-bold py-3.5 rounded-2xl text-sm uppercase tracking-widest active:scale-95 transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        showConfirm('⚠️ FORZAR CAMBIO', `Se perderán definitivamente ${warningModal.tickets.length} ventas y reservas. ¿Continuar?`, () => applyTicketChange(warningModal.newCount));
                      }}
                      className="flex-1 bg-red-500/20 border border-red-500/30 text-red-400 font-bold py-3.5 rounded-2xl text-sm uppercase tracking-widest active:scale-95 transition-all"
                    >
                      Forzar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TICKET DETAILS MODAL (FOR ADMIN/SELLER) */}
          {selectedTicketId && (() => {
            const t = tickets.find(x => x.id === selectedTicketId);
            if (!t) return null;
            const seller = sellers.find(s => s.id === t.sellerId);
            return (
              <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 glass-heavy backdrop-blur-xl animate-fade-in text-white">
                <div className="bg-[#0c0c0c] w-full max-w-sm rounded-[40px] border border-white/10 shadow-2xl overflow-hidden animate-scale-up">
                  <div className="p-8 text-center bg-primary/10 relative">
                    <button onClick={() => setSelectedTicketId(null)} className="absolute top-6 right-6 text-white/30"><span className="material-icons-round">close</span></button>
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/20 text-primary flex items-center justify-center mb-4 border border-primary/30">
                      <span className="text-2xl font-bold">#{t.id}</span>
                    </div>
                    <h3 className="text-xl font-bold tracking-widest uppercase">DETALLE DE VENTA</h3>
                  </div>
                  <div className="p-8 space-y-6">
                    <div className="space-y-4">
                      <div className="flex items-center gap-4 glass p-4 rounded-2xl border-white/5">
                        <span className="material-icons-round text-primary/60">person</span>
                        <div><p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Participante</p><p className="font-bold text-sm">{t.participant?.name || '---'}</p></div>
                      </div>
                      <div className="flex items-center gap-4 glass p-4 rounded-2xl border-white/5">
                        <span className="material-icons-round text-primary/60">phone</span>
                        <div><p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Teléfono</p><p className="font-bold text-sm">{t.participant?.phone || '---'}</p></div>
                      </div>
                      <div className="flex items-center gap-4 glass p-4 rounded-2xl border-white/5">
                        <span className="material-icons-round text-primary/60">storefront</span>
                        <div><p className="text-[10px] text-white/40 uppercase font-bold tracking-widest">Vendido por</p><p className="font-bold text-sm text-primary">{seller?.name || 'Organic / Principal'}</p></div>
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-3">
                        {t.status === 'REVISANDO' && (
                          <button onClick={() => { updateTicketInSupabase(t.id, { status: 'PAGADO' }); setSelectedTicketId(null); }} className="flex-1 py-4 rounded-2xl bg-accent-emerald/20 text-accent-emerald font-bold uppercase tracking-widest text-[10px] border border-accent-emerald/30">Verificar Pago</button>
                        )}
                        <button onClick={() => { if (confirm("¿Eliminar reserva?")) { updateTicketInSupabase(t.id, { status: 'AVAILABLE', participant: undefined, seller_id: undefined } as any); setSelectedTicketId(null); } }} className="flex-1 py-4 rounded-2xl bg-red-500/20 text-red-400 font-bold uppercase tracking-widest text-[10px] border border-red-500/30">Eliminar</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* GOLDEN TICKET MODAL (SUCCESS) */}
          {showGoldenTicket.show && (
            <div className="fixed inset-0 z-[10001] flex items-center justify-center p-6 glass-heavy backdrop-blur-2xl animate-fade-in overflow-y-auto">
              <div className="max-w-sm w-full animate-golden-entry py-10">
                <div className="relative bg-[#D4AF37] p-1 rounded-sm shadow-[0_0_50px_rgba(212,175,55,0.6)]">
                  <div className="absolute top-[-8px] left-0 right-0 flex justify-between px-2 overflow-hidden">
                    {Array.from({ length: 15 }).map((_, i) => <div key={i} className="w-4 h-4 bg-[#0a0a0b] rounded-full -mt-2"></div>)}
                  </div>
                  <div className="absolute bottom-[-8px] left-0 right-0 flex justify-between px-2 overflow-hidden">
                    {Array.from({ length: 15 }).map((_, i) => <div key={i} className="w-4 h-4 bg-[#0a0a0b] rounded-full -mb-2"></div>)}
                  </div>

                  <div className="bg-[#D4AF37] border-2 border-[#8B732A] p-6 text-[#4a3a05] text-center font-serif py-12 relative overflow-hidden">
                    <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#4a3a05 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                    <div className="relative z-10">
                      <h4 className="text-[10px] tracking-[0.4em] uppercase font-bold mb-4 opacity-70">¡Felicidades!</h4>
                      <h2 className="text-4xl font-extrabold mb-2 tracking-tighter italic">TICKET DORADO</h2>
                      <div className="w-12 h-0.5 bg-[#4a3a05] mx-auto mb-6"></div>
                      <p className="text-xs font-bold leading-relaxed mb-8 px-6 uppercase tracking-wider">Has adquirido el pase a la fortuna.<br />Números de la suerte:</p>
                      <div className="flex flex-wrap justify-center gap-2 mb-10">
                        {showGoldenTicket.numbers.map(n => <div key={n} className="bg-[#4a3a05] text-[#D4AF37] w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold shadow-xl">{n}</div>)}
                      </div>
                      <img src={LOGO} className="w-16 mx-auto mb-6 grayscale opacity-60" />
                      <p className="text-[9px] font-bold uppercase tracking-[0.5em] mb-10 opacity-70">Suerte en el sorteo</p>
                      <button onClick={() => { setShowGoldenTicket({ show: false, numbers: [] }); setView('HOME'); }} className="w-full bg-[#4a3a05] text-[#D4AF37] font-bold py-4 rounded-xl uppercase text-xs tracking-[0.2em] shadow-2xl active:scale-95 transition-all">ENTRAR AL SORTEO</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* LOGIN MODAL */}
          {showLogin && (
            <div className="fixed inset-0 z-[9500] bg-black/98 backdrop-blur-3xl flex flex-col items-center justify-center p-12">
              <span className="material-icons-round text-primary text-8xl mb-10">security</span>
              <p className="text-white/40 text-[10px] uppercase tracking-[0.4em] font-bold mb-8">{showLogin === 'ADMIN' ? 'Acceso Admin' : 'Acceso Vendedor'}</p>
              <input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="• • • •" className="bg-transparent border-b-4 border-primary text-center text-5xl text-white py-6 w-56 mb-16 outline-none font-mono tracking-[0.6em] focus:border-accent-purple transition-all" />
              <button onClick={handleLogin} className="gold-gradient text-black font-bold px-20 py-5 rounded-full uppercase text-sm tracking-[0.3em] shadow-gold-glow active:scale-95 transition-all">ACCEDER</button>
              <button onClick={() => { setShowLogin(null); setPin(''); }} className="mt-12 text-zinc-600 font-bold uppercase text-[10px] tracking-widest underline">Cancelar</button>
            </div>
          )}
          {/* SYSTEM MODAL (REPLACEMENT FOR ALERT/CONFIRM/PROMPT) */}
          {modal.show && (
            <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 glass-heavy backdrop-blur-xl animate-fade-in text-white">
              <div className="bg-[#0c0c0c] w-full max-w-sm rounded-[40px] border border-white/10 shadow-2xl overflow-hidden animate-scale-up">
                <div className={`p-8 text-center ${modal.type === 'ALERT' && modal.title === 'ERROR' ? 'bg-red-500/10' : 'bg-primary/10'}`}>
                  <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 ${modal.type === 'CONFIRM' ? 'bg-orange-500/20 text-orange-400' : modal.type === 'ALERT' ? 'bg-primary/20 text-primary' : 'bg-accent-emerald/20 text-accent-emerald'}`}>
                    <span className="material-icons-round text-3xl">
                      {modal.type === 'CONFIRM' ? 'help_outline' : (modal.type === 'ALERT' && modal.title === 'ERROR') ? 'error_outline' : modal.type === 'ALERT' ? 'check_circle_outline' : 'person_add'}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white tracking-widest uppercase">{modal.title}</h3>
                </div>

                <div className="p-8 space-y-6">
                  {modal.type === 'SELLER_FORM' ? (
                    <div className="space-y-4">
                      <input id="modal-input-1" placeholder="NOMBRE DEL VENDEDOR" className="casino-input w-full uppercase" />
                      <input id="modal-input-2" placeholder="PIN (4 DÍGITOS)" className="casino-input w-full" maxLength={4} />
                    </div>
                  ) : (
                    <p className="text-white/60 text-center text-sm font-medium leading-relaxed">{modal.message}</p>
                  )}

                  <div className="flex gap-3">
                    {modal.type === 'CONFIRM' || modal.type === 'SELLER_FORM' ? (
                      <>
                        <button
                          onClick={() => setModal({ ...modal, show: false })}
                          className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/10 text-white/40 font-bold uppercase tracking-widest text-xs"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => {
                            const v1 = (document.getElementById('modal-input-1') as HTMLInputElement)?.value;
                            const v2 = (document.getElementById('modal-input-2') as HTMLInputElement)?.value;
                            modal.onConfirm?.(v1, v2);
                            setModal({ ...modal, show: false });
                          }}
                          className="flex-1 py-4 rounded-2xl gold-gradient text-black font-extrabold uppercase tracking-widest text-xs shadow-gold-glow"
                        >
                          Confirmar
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setModal({ ...modal, show: false })}
                        className="w-full py-4 rounded-2xl gold-gradient text-black font-extrabold uppercase tracking-widest text-xs shadow-gold-glow"
                      >
                        ENTENDIDO
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
