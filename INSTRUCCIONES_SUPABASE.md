# 📋 INSTRUCCIONES PARA CONFIGURAR SUPABASE

## Paso 1: Ejecutar el SQL

1. Ve a tu dashboard de Supabase: https://supabase.com/dashboard
2. Selecciona tu proyecto (el mismo de RIFA1000)
3. En el menú lateral, haz clic en **SQL Editor**
4. Crea una nueva query
5. Copia TODO el contenido del archivo `sql/init.sql`
6. Pégalo en el editor
7. Haz clic en **RUN** (o presiona Ctrl+Enter)

Deberías ver el mensaje: `KERIFA TABLES CREATED SUCCESSFULLY!`

## Paso 2: Verificar las tablas

1. En el menú lateral, haz clic en **Table Editor**
2. Deberías ver las nuevas tablas:
   - `kerifa_config`
   - `kerifa_tickets`
   - `sellers` (ya existía de RIFA1000)

## Paso 3: Listo

Una vez ejecutado el SQL, la aplicación kerifa se conectará automáticamente a Supabase y todos los datos se sincronizarán en tiempo real entre todos los dispositivos.

---

## ⚠️ IMPORTANTE

- **NO borres las tablas de RIFA1000** (`tickets`, `raffle_config`)
- Las dos rifas comparten la tabla `sellers` pero tienen sus propias tablas de tickets y config
- Cada rifa es independiente y no interfiere con la otra
