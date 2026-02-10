
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// No lanzamos error aquí para evitar que la app entera muera antes de cargar.
// El error se manejará dentro de los componentes.
export const supabase = (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null as any;

if (!supabase) {
    console.warn("⚠️ Supabase: Faltan variables de entorno. La aplicación no podrá conectar con la base de datos.");
}
