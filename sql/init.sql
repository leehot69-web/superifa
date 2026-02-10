-- ============================================================
-- KERIFA - Tablas para la rifa "Gran Rifa"
-- Ejecutar en Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================

-- 1. Configuración de la rifa
CREATE TABLE IF NOT EXISTS public.kerifa_config (
  id INT PRIMARY KEY DEFAULT 1,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tickets de la rifa
CREATE TABLE IF NOT EXISTS public.kerifa_tickets (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'REVISANDO', 'PAGADO')),
  participant JSONB,
  seller_id UUID REFERENCES public.sellers(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Vendedores de kerifa (usa la misma tabla sellers que ya existe)
-- No se crea tabla nueva, se reutiliza public.sellers

-- 4. Habilitar RLS (Row Level Security)
ALTER TABLE public.kerifa_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kerifa_tickets ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de acceso para kerifa_config
CREATE POLICY "kerifa_config_select" ON public.kerifa_config FOR SELECT TO anon USING (true);
CREATE POLICY "kerifa_config_insert" ON public.kerifa_config FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "kerifa_config_update" ON public.kerifa_config FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 6. Políticas de acceso para kerifa_tickets
CREATE POLICY "kerifa_tickets_select" ON public.kerifa_tickets FOR SELECT TO anon USING (true);
CREATE POLICY "kerifa_tickets_insert" ON public.kerifa_tickets FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "kerifa_tickets_update" ON public.kerifa_tickets FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "kerifa_tickets_delete" ON public.kerifa_tickets FOR DELETE TO anon USING (true);

-- 7. Políticas extras para sellers si no existen
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sellers' AND policyname = 'sellers_update_all') THEN
    CREATE POLICY "sellers_update_all" ON public.sellers FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sellers' AND policyname = 'sellers_delete_all') THEN
    CREATE POLICY "sellers_delete_all" ON public.sellers FOR DELETE TO anon USING (true);
  END IF;
END $$;

-- 8. Habilitar Realtime para las tablas kerifa
ALTER PUBLICATION supabase_realtime ADD TABLE public.kerifa_config;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kerifa_tickets;

-- 9. Insertar config inicial (solo si no existe)
INSERT INTO public.kerifa_config (id, data)
VALUES (1, '{
  "drawTitle": "GRAN RIFA",
  "tickerMessage": "¡La suerte te espera hoy! 🎰 Gran Premio Mayor disponible",
  "winners": [],
  "whatsapp": "584120000000",
  "ticketPriceUsd": 10,
  "ticketPriceLocal": 360,
  "drawTimestamp": "",
  "commissionPct": 10,
  "prizes": [
    {"id": "1", "name": "Camioneta", "subtitle": "Premio Mayor", "image": ""},
    {"id": "2", "name": "Segundo Premio", "subtitle": "Sorpresa", "image": ""},
    {"id": "3", "name": "Tercer Premio", "subtitle": "Sorpresa", "image": ""}
  ]
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

SELECT 'KERIFA TABLES CREATED SUCCESSFULLY!' AS result;
