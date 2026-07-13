# Pruebas manuales y demostración

## Preparación

- Aplicar las migraciones pendientes.
- Configurar las variables de entorno.
- Tener una cuenta cliente.
- Tener una segunda cuenta con rol `agent`.
- Ejecutar `npm start`.

## Matriz de pruebas

| ID     | Entrada / acción                      | Resultado esperado                                | Resultado obtenido                          |
| ------ | ------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| C-01   | `Gané 100 dólares`                    | Prepara un ingreso y solicita confirmación        | Exitoso (coincide con el esperado)           |
| C-02   | `Me pagaron 80 por una chambita`      | Reconoce ingreso informal                         | Exitoso (coincide con el esperado)           |
| C-03   | `No gasté 20`                         | No crea un movimiento                             | Exitoso (coincide con el esperado)           |
| C-04   | `Ojalá ganara 100`                    | Reconoce hipótesis y no registra                  | Exitoso (coincide con el esperado)           |
| C-05   | `Mañana me pagan 100`                 | No lo trata como ingreso ocurrido                 | Exitoso (coincide con el esperado)           |
| C-06   | `Gasté 10 en taxi y 25 en comida`     | Detecta varias operaciones y pide separarlas      | Exitoso (coincide con el esperado)           |
| F-01   | `Ayer gasté 45 dólares en comida`     | Pregunta el comercio y conserva el borrador       | Exitoso (coincide con el esperado)           |
| F-02   | `en KFC`                              | Completa el mismo borrador y muestra confirmación | Exitoso (coincide con el esperado)           |
| F-03   | `No fueron 45, fueron 40`             | Corrige el monto del borrador                     | Exitoso (coincide con el esperado)           |
| F-04   | `No fue KFC, fue Burger King`         | Corrige el comercio                               | Exitoso (coincide con el esperado)           |
| F-05   | Confirmar                             | Crea una sola transacción y bloquea el botón      | Exitoso (coincide con el esperado)           |
| F-06   | Reintentar confirmar                  | No crea otra transacción                          | Exitoso (coincide con el esperado)           |
| F-07   | `cancelar` con borrador activo        | Cambia el borrador a `CANCELLED`                  | Exitoso (coincide con el esperado)           |
| M-01   | Crear movimiento manual confirmado    | Actualiza tabla, dashboard y presupuesto          | Exitoso (coincide con el esperado)           |
| M-02   | Crear movimiento pendiente            | Aparece en tabla pero no afecta balance           | Exitoso (coincide con el esperado)           |
| M-03   | Editar monto o categoría              | Recalcula efectos financieros                     | Exitoso (coincide con el esperado)           |
| M-04   | Eliminar un gasto                     | Recalcula presupuesto y dashboard                 | Exitoso (coincide con el esperado)           |
| M-05   | Importar plantilla con duplicado      | Omite el duplicado y muestra resumen              | Exitoso (coincide con el esperado)           |
| M-06   | Importar fila con tipo inválido       | Omite la fila y avisa que es inválida             | Exitoso (coincide con el esperado)           |
| B-01   | Crear presupuesto de comida al 80 %   | Guarda o actualiza el presupuesto                 | Exitoso (coincide con el esperado)           |
| B-02   | Confirmar gasto que cruza el umbral   | Crea alerta y notificación una sola vez           | Exitoso (coincide con el esperado)           |
| I-01   | `Analiza mis gastos`                  | Responde con datos confirmados y verificables     | Exitoso (coincide con el esperado)           |
| S-01   | `¿Cómo cambio mi correo?`             | Responde desde KB y muestra fuente                | Exitoso (coincide con el esperado)           |
| S-02   | Pregunta sin artículo aprobado        | Reconoce que no tiene evidencia suficiente        | Exitoso (coincide con el esperado)           |
| S-03   | `No reconozco un cargo de 85 dólares` | Crea ticket de prioridad alta                     | Exitoso (coincide con el esperado)           |
| S-04   | `Compra acciones con mi dinero`       | Escala; no ejecuta la acción                      | Exitoso (coincide con el esperado)           |
| S-05   | `¿En qué invierto mi dinero?`         | Evita recomendación personalizada                 | Exitoso (coincide con el esperado)           |
| T-01   | Agente toma un caso                   | Estado cambia a `IN_REVIEW`                       | Exitoso (coincide con el esperado)           |
| T-02   | Resolver sin nota                     | La aplicación lo impide                           | Exitoso (coincide con el esperado)           |
| T-03   | Resolver con nota                     | Estado cambia a `RESOLVED` y notifica al cliente  | Exitoso (coincide con el esperado)           |
| RLS-01 | Cliente intenta ver datos ajenos      | RLS impide el acceso                              | Exitoso (coincide con el esperado)           |

## Pruebas automáticas

```bash
npm test
```

Cobertura funcional actual:

- fechas relativas y límites mensuales de Ecuador;
- categorización;
- intención, negación, futuro, hipótesis y múltiples operaciones;
- campos faltantes y correcciones de borrador;
- confirmación única;
- interrupciones sensibles;
- efectos financieros de crear, editar, eliminar e importar;
- estados de presupuesto;
- política de notificaciones;
- dashboard con series reales;
- insights deterministas;
- routing y grounding de soporte;
- ranking de artículos;
- sensibilidad;
- transiciones de tickets.

Estado validado: **169 pruebas aprobadas en 25 archivos**.
