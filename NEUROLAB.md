# Prueba de UX en el NeuroLab UVG — operación de la plataforma

Hoja de trabajo para el moderador y para quien prepare las sesiones.
Acompaña al guion del experimento («Script Instrucciones Teleprogreso»,
Ingeniería de Software 2, Sección 10, Grupo 2).

El guion manda en todo lo que es procedimiento con el participante. Este
archivo solo cubre la parte técnica: con qué cuentas se entra, qué datos tiene
que ver el participante al empezar y cómo se devuelve todo a ese punto entre
un voluntario y el siguiente.

---

## Dónde se entra

```
https://tp-ops.dev/login
```

El dominio cambió: la versión del guion que circula en papel todavía dice
`frontend-production-c7b8.up.railway.app`. La copia del Drive ya está
corregida — si alguien imprime del archivo viejo, hay que corregir esa línea a
mano antes de la sesión.

## Cuentas

| Bloque | Rol en la prueba | Correo | Contraseña |
|---|---|---|---|
| A | Técnico de campo | `tecnico@teleprogreso.com` | `Tecnico1234!` |
| B | Supervisor / administrador | `admin@teleprogreso.com` | `Admin1234!` |

Son las dos únicas cuentas que el participante usa. Van en la hoja impresa de
credenciales que se le entrega; el moderador no las dicta ni teclea.

El resto de los empleados que aparecen en pantalla (María López, Diego
Morales, Ana Castillo) existen para dar cuerpo al escenario: nadie inicia
sesión con ellos durante la prueba.

---

## Reset entre participantes

Mientras el voluntario anterior contesta la encuesta en el CIT-415 A, desde la
carpeta del repo:

```bash
./scripts/reset-neurolab.ps1
```

Tarda unos segundos. Termina con `LISTO` en verde, o con `EL RESET FALLÓ` y
qué revisar. Si falla, **no se empieza la siguiente sesión**: el participante
vería los datos que dejó el anterior y su registro no sería comparable con el
de los demás.

El script comprueba él mismo que el escenario quedó bien y enumera condición
por condición, así que no hay que ir a revisar la app a mano.

Después del reset: dejar el navegador en la pantalla de inicio de sesión, con
la sesión anterior cerrada, maximizado y con el mismo zoom de siempre.

### Por qué no se corre desde la laptop

La base de datos de Railway no expone proxy público, así que no es alcanzable
desde fuera de su red. El reset se ejecuta **dentro** del contenedor del
backend; el script de arriba es un envoltorio de:

```bash
railway ssh --service Backend "cd /app && python seed_neurolab.py --reset"
```

**Hay que probar esta línea una vez antes del día de la prueba**, no el mismo
día: si la CLI de Railway no tiene sesión abierta o la carpeta no está
enlazada al proyecto, es mejor descubrirlo con tiempo. `railway whoami` y
`railway status` lo dicen en dos segundos.

---

## Estado de partida

Lo que el participante tiene que encontrar al iniciar el Bloque A:

- **4 técnicos** en plantilla; **3 en jornada** y el de prueba **sin entrada
  marcada** (es la tarea A1).
- **3 tareas** asignadas al técnico de prueba, las tres todavía *pendientes*,
  **una marcada como urgente** — la de A2.
- Los otros tres técnicos con **cargas distintas** (4, 2 y 1 tareas activas),
  para que el selector de reasignación de B3 muestre números diferentes y «el
  de menor carga» sea una sola persona, sin empates.
- **2 alertas operativas pendientes**: una **crítica** y una de
  **advertencia** (tarea B2).
- Inventario completo y todo por encima del stock mínimo, para que no
  aparezcan alertas de stock que el guion no pide.

### Tareas señaladas

| Tarea | Cuál es |
|---|---|
| A2 · la urgente que hay que iniciar | «Reparación de señal — Tienda El Ahorro» |
| B2 · la alerta crítica | «Cambio de poste dañado — Callejón San José» (vencida) |
| B3 · la que se reasigna | «Instalación TV Cable — Restaurante Sabor Latino» |

La de B3 es de María López, que es la más cargada. La de menor carga es **Ana
Castillo** (1 tarea), que además es la que está más cerca del sitio: carga y
cercanía apuntan a la misma persona, así que la decisión no es ambigua. No
sugerir ningún técnico ni ningún criterio al participante.

---

## Números del panel del supervisor (tarea B1)

B1 pide decir cuántos técnicos están en jornada y cuántas tareas quedan
pendientes. **El número correcto es el que la pantalla muestra en ese
momento**, y depende de lo que el participante hizo en el Bloque A:

| Situación | Técnicos en jornada | Tareas pendientes |
|---|---|---|
| Al sembrar (antes de A1) | 3 de 4 | 8 |
| **En B1, si A1 y A2 salieron bien** | **4 de 4** | **7** |
| Si no logró marcar entrada (A1) | 3 de 4 | 8 |
| Si marcó entrada pero no inició la tarea (A2) | 4 de 4 | 8 |

El caso normal es el de la fila en negrita. Ojo con esto: la nota del guion
dice «3 de ellos en jornada», y eso describe el estado **al sembrar**, no lo
que se ve en B1 — cuando el participante llega al Bloque B ya marcó su propia
entrada y son 4. Cerrar sesión (A4) no cierra la jornada, así que sigue
contando como en jornada.

---

## Cosas que conviene saber antes de la sesión

**A2 depende de A1.** Iniciar una tarea exige tener la jornada abierta. Si el
participante no logra marcar entrada, al intentar iniciar la tarea le va a
salir un error. No es un fallo de la app: es la regla de negocio. Anotarlo y
seguir, según el guion.

**Marcar entrada no necesita GPS.** La ubicación es opcional, así que no
importa si el navegador del laboratorio tiene la geolocalización bloqueada.

**La tarea urgente aparece de primera en la lista.** La app ordena la ruta del
día por prioridad, así que la urgente de A2 sale arriba. La fricción que A2
busca documentar no es encontrarla, es que el botón «Iniciar Tarea» no está en
la tarjeta: aparece dentro del detalle que se abre con «Ver detalles de la
orden».

**El cierre de sesión no cierra la jornada.** Son dos cosas distintas en la
app, y el guion no pide marcar salida en ningún momento.

---

## Qué hace el seed por dentro

`backend/seed_neurolab.py`. La cabecera del archivo explica cada decisión; lo
que importa aquí:

- Es un seed **aparte** de `seed.py`, el de demostración. Ese no sirve para la
  prueba: deja la tarea urgente ya iniciada (A2 no tendría nada que hacer),
  deja al técnico de prueba con entrada ya marcada (A1 tampoco), y produce
  cinco alertas críticas en vez de una crítica y una advertencia.
- `seed.py` sigue siendo el de la demo y no se tocó. Un reinicio del
  contenedor no pisa el escenario del experimento: `seed.py` solo siembra si
  la base está vacía.
- La alerta de advertencia va fechada **ayer** a propósito. La única condición
  que genera severidad «advertencia» es que un técnico no haya marcado
  entrada, y el único que no la tiene es el de prueba — que la marca en A1. En
  cuanto lo hace, el backend cierra esa alerta solo y desaparecería antes de
  que el participante llegue al Bloque B, que es donde tiene que encontrarla.
  Fechada ayer sobrevive, porque el cierre automático no toca los avisos de
  días anteriores. Es lo que hace que los 8 participantes vean lo mismo.

### Si hay que rehacer el escenario a mano

```bash
railway ssh --service Backend "cd /app && python seed_neurolab.py"
```

Sin `--reset` el script no borra nada: solo explica qué hace y sale. El flag
es obligatorio justamente para que no se dispare por accidente.
