
import { createClient } from '@supabase/supabase-js';

// Usamos variables de entorno para mayor seguridad y facilidad al subir a Vercel
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("ERROR: Faltan las variables de entorno de Supabase. Verifica tu archivo .env o la configuración en Vercel.");
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
