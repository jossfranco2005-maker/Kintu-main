# Checklist de entrega del hackathon

## Enlaces requeridos

- [ ] Video público de máximo 3 minutos
- [ ] ZIP público del código fuente
- [ ] Documento explicativo público
- [ ] Repositorio público
- [ ] Despliegue público funcional

## Código

- [ ] `main` sincronizada
- [ ] `npm ci` funciona
- [ ] `npm run verify` termina correctamente
- [ ] Todas las migraciones están incluidas y aplicadas
- [ ] `.env.example` está actualizado
- [ ] No se incluyen `node_modules`, `.output`, `.wrangler` ni `.env` en el ZIP final
- [ ] README visible en la raíz
- [ ] No existen claves o secretos en archivos o historial reciente

## Migraciones

- [ ] `transaction_drafts` existe
- [ ] `origin_draft_id` e índice único existen
- [ ] Flujo humano de tickets aplicado
- [ ] Tabla y políticas de notificaciones aplicadas
- [ ] Política de eliminación de notificaciones aplicada
- [ ] `event_key` e idempotencia de notificaciones aplicados

## Calidad técnica

- [ ] 169 pruebas aprobadas
- [ ] TypeScript sin errores
- [ ] Lint sin errores
- [ ] Build cliente, SSR y Nitro aprobado
- [ ] CSRF activo y sin advertencia al iniciar
- [ ] RLS probado con dos usuarios
- [ ] Librería Excel cargada bajo demanda

## Demostración

- [ ] Cuenta cliente disponible
- [ ] Cuenta agente disponible
- [ ] Rol `agent` confirmado en Supabase
- [ ] Presupuesto de comida configurado
- [ ] Artículos aprobados visibles
- [ ] Flujo de ingreso y gasto probado
- [ ] Corrección de borrador probada
- [ ] Mis movimientos e importación probados
- [ ] Notificación de presupuesto probada
- [ ] Insight probado
- [ ] Flujo de soporte probado
- [ ] Ticket resuelto de extremo a extremo

## Documento

- [ ] Track asignado
- [ ] Problema y solución
- [ ] Tipo de negocio
- [ ] Diagrama de arquitectura
- [ ] Integración empresarial
- [ ] Riesgos y guardrails
- [ ] Canal web / simulación de WhatsApp explicado
- [ ] Limitaciones declaradas
- [ ] Enlace al repositorio
- [ ] Enlace al despliegue

## Video

- [ ] Texto legible en pantalla
- [ ] No aparecen claves ni datos privados
- [ ] Demostración real, no solo diapositivas
- [ ] Duración verificada
- [ ] Audio comprensible
- [ ] Enlace probado en modo incógnito

## Entrega

- [ ] Todos los enlaces permiten acceso sin solicitar permisos
- [ ] Correo final revisado por el equipo
- [ ] Copia de respaldo del ZIP y documento
