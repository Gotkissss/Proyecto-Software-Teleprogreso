# reset-neurolab.ps1 — Devuelve la app al estado de partida del experimento
# ---------------------------------------------------------------------------
# Se corre ENTRE PARTICIPANTES de la prueba de UX del NeuroLab, mientras el
# voluntario anterior contesta la encuesta en el CIT-415 A.
#
#   .\scripts\reset-neurolab.ps1
#
# Qué hace: ejecuta `seed_neurolab.py --reset` DENTRO del contenedor del
# backend en Railway. Tiene que ser dentro porque la base de Railway no expone
# proxy público: desde la laptop no se le puede llegar.
#
# ⚠️  BORRA todos los datos de operación y vuelve a sembrar el escenario. Es
# exactamente lo que se quiere entre participantes, y nada que se quiera con
# una sesión en curso.
#
# Requisitos (verificarlos UNA VEZ antes de la primera sesión, no el día de):
#   - Railway CLI instalada y con sesión: `railway whoami`
#   - la carpeta del repo enlazada al proyecto: `railway status`
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Continue'

# El script vive en scripts/, pero railway necesita correr desde la raíz del
# repo, que es donde está el enlace al proyecto.
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

Write-Host ""
Write-Host "Reiniciando el escenario del NeuroLab..." -ForegroundColor Cyan
Write-Host "(esto borra los datos de la sesion anterior)" -ForegroundColor DarkGray
Write-Host ""

$reloj = [System.Diagnostics.Stopwatch]::StartNew()

railway ssh --service Backend "cd /app && python seed_neurolab.py --reset"

$codigo = $LASTEXITCODE
$reloj.Stop()
$segundos = [math]::Round($reloj.Elapsed.TotalSeconds, 1)

Write-Host ""
if ($codigo -eq 0) {
    Write-Host "LISTO en $segundos s — la app ya puede recibir al siguiente participante." -ForegroundColor Green
    Write-Host "Deja el navegador en la pantalla de inicio de sesion, con la sesion anterior cerrada." -ForegroundColor Green
}
else {
    Write-Host "EL RESET FALLO (codigo $codigo, $segundos s)." -ForegroundColor Red
    Write-Host "NO empieces la siguiente sesion sin revisarlo: el participante veria" -ForegroundColor Red
    Write-Host "los datos que dejo el anterior y su registro no seria comparable." -ForegroundColor Red
    Write-Host ""
    Write-Host "Que revisar, en este orden:" -ForegroundColor Yellow
    Write-Host "  1. railway whoami      (hay sesion abierta?)"
    Write-Host "  2. railway status      (la carpeta esta enlazada al proyecto teleprogreso?)"
    Write-Host "  3. Si el escenario quedo a medias, el propio seed lo dice arriba:"
    Write-Host "     vuelve a correr este script."
}
Write-Host ""

exit $codigo
