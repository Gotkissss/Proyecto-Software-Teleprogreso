# Guía de estilo — Frontend Teleprogreso

Todos los tokens viven en [`src/index.css`](src/index.css) dentro de `:root`.
Regla de oro: **ninguna pantalla define colores, tamaños de fuente, espaciados,
radios ni sombras a mano** — siempre `var(--token)`. Si un valor no existe como
token, se agrega el token primero.

## Paleta

| Token | Uso |
| --- | --- |
| `--color-primary` / `-dark` / `-deep` | Azul de marca. Acciones principales, estados activos. `-deep` para texto azul sobre fondo claro. |
| `--color-primary-light` / `-50` | Tintes de fondo (item activo del nav, selección, chips). |
| `--color-accent` / `-dark` / `-light` | Rojo de marca. Solo para alertas/contadores y acciones destructivas — no es un color decorativo. |
| `--color-bg` / `-alt` | Fondo de página / fondo alterno (hover suave, círculos de EmptyState). |
| `--color-surface` / `-alt` | Tarjetas, headers, modales. |
| `--color-border` / `-strong` / `-hover` | Bordes en orden creciente de énfasis. |
| `--color-text` / `-secondary` / `-muted` | Texto en orden decreciente de énfasis. |
| `--color-success/warning/danger/info` + `-dark` / `-light` / `-bg` | Estados. En fondos tintados (`-light`) el texto va en el tono `-dark` para que contraste. |

Gradientes (`--gradient-primary`, `--gradient-accent`, `--gradient-success`)
solo en botones y héroes — nunca en texto ni bordes.

## Tipografía

Fuente: `--font-sans` en todo; `--font-mono` solo para datos técnicos.

Escala: `--text-xs` (11px) → `--text-sm` (12px) → `--text-base` (13px) →
`--text-md` (14px) → `--text-lg` (15px) → `--text-xl` (16px). Títulos de
página pueden ir más grandes, pero cualquier texto de UI usa la escala.

## Espaciado, radios y sombras

- Espaciado: `--space-1` (4px) … `--space-20` (80px), múltiplos de 4.
- Radios: `--radius-sm` inputs pequeños · `--radius-md` botones/ítems de nav ·
  `--radius-lg` tarjetas · `--radius-xl` modales · `--radius-full` píldoras y avatares.
- Sombras: `--shadow-xs/sm` tarjetas en reposo · `--shadow-md` hover ·
  `--shadow-lg` dropdowns/toasts · `--shadow-xl` modales y cajones.

## Capas (z-index)

Siempre por token, nunca números sueltos: `--z-bottom-nav` (40) <
`--z-sidebar-backdrop` (44) < `--z-sidebar` (45) < `--z-header` (50) <
`--z-dropdown` (60) < `--z-modal` (100) < `--z-toast` (110).

## Botones

Clases globales definidas en `index.css`; ninguna pantalla inventa botones:

```jsx
<button className="btn btn-primary">Guardar</button>
<button className="btn btn-secondary">Ver detalle</button>
<button className="btn btn-danger">Eliminar</button>
<button className="btn btn-ghost">Cancelar</button>
```

- Variantes: `btn-primary` (acción principal, máx. una por vista),
  `btn-secondary` (alternativas), `btn-danger` (destructivas),
  `btn-success` (confirmación positiva, p.e. "Finalizar tarea"),
  `btn-ghost` (terciarias: cancelar, cerrar).
- Tamaños: por defecto 40px de alto; `btn-sm` (32px) para tablas,
  `btn-lg` (48px) para la acción principal en móvil.
- Desde un CSS Module se heredan con `composes: btn btn-primary from global;`
  (ver `ui/PageState.module.css` como ejemplo).

## Componentes base (`src/components/ui/`)

Usarlos siempre en lugar de versiones inline por página:

- **Badge** — estados y prioridades. Mapea solo el label (`<Badge label="pendiente" />`).
- **Modal / ModalActions** — todo diálogo. Nunca un overlay hecho a mano.
- **Toast** (`useToast()`) — confirmaciones y errores puntuales.
- **Spinner** — indicador de carga inline.
- **PageState** — cargando/error/vacío de una pantalla o sección (ver sus
  advertencias de uso en el propio archivo).
- **EmptyState** — lo usa PageState; directo solo para vacíos con acción propia.

## Layouts

- **Supervisor** (`SupervisorLayout`): barra lateral fija (`LayoutSidebar`) con
  grupos de navegación; en ≤1024px se pliega a cajón y se abre desde el header.
  Las páginas usan `min-height: 100%` (no `100vh`: el alto ya lo da el layout).
- **Técnico** (`AppLayout`): header compartido (`LayoutHeader`) + tab bar
  inferior (`LayoutBottomNav`), pensado para uso con una mano en móvil.
- Animaciones: usar las keyframes globales (`fadeIn`, `fadeInScale`, …) y los
  tiempos `--transition` / `--transition-slow`; toda animación de entrada debe
  respetar `prefers-reduced-motion`.

## Checklist al migrar una pantalla

1. Cero valores crudos: colores, px de fuente, sombras y z-index → tokens.
2. Botones con las clases `btn ...`.
3. Estados de carga/error/vacío con `PageState`.
4. `min-height: 100%` en el contenedor de página (no `100vh`).
5. Targets táctiles de al menos 40px en vistas del técnico.
