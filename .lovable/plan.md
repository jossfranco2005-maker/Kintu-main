# Kintu Finance AI — Estado implementado

Kintu es el prototipo del Track 2 del hackathon. La fuente de verdad del proyecto es el código y la documentación de la raíz.

## Implementado

- Registro conversacional de ingresos y gastos.
- Extracción estructurada con Groq y validación Zod.
- Borradores persistentes con estados `NEEDS_INFO`, `AWAITING_CONFIRMATION`, `SAVED` y `CANCELLED`.
- Confirmación idempotente mediante `origin_draft_id`.
- Fechas relativas en zona `America/Guayaquil`.
- Presupuestos, resúmenes y alertas deterministas.
- Soporte desde artículos aprobados y citas validadas.
- Detección de reclamos y operaciones sensibles.
- Tickets con contexto, historial y prioridad.
- Bandeja humana para roles `agent` y `admin`.
- 42 pruebas automatizadas.

## Arquitectura actual

- Frontend y servidor: TanStack Start + React + TypeScript.
- Persistencia y autenticación: Supabase.
- Modelo: Groq, `llama-3.3-70b-versatile`.
- Build: Vite + Nitro, preset Cloudflare.

## Fuera de alcance

- WhatsApp real.
- Integración bancaria real.
- Operaciones bursátiles o transferencias reales.
- Recomendaciones personalizadas de inversión.

Consultar `README.md` y `docs/` para instalación, arquitectura, pruebas y entrega.
