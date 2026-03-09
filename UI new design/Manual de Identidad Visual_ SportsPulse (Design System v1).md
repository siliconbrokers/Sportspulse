Manual de Identidad Visual: SportsPulse (Design System v1.0) Misión Visual: Convertir datos deportivos abstractos en una experiencia visual premium, energética e inmersiva. El sitio debe sentirse como una transmisión de TV deportiva moderna mezclada con una app nativa de alta gama.

1. Concepto y Pilares de Diseño El diseño de SportsPulse se basa en tres pilares:

Cuadrícula Bento (The Box Economy): Todo el contenido se organiza en tarjetas modulares y proporcionales. Esto permite destacar la noticia principal sobre las secundarias de forma jerárquica y limpia. (Ver image\_0.png y image\_2.png).

Sistemas de Bordes y Radio (Consistent Radii): Todos los elementos (tarjetas, botones, imágenes) deben tener un radio de borde consistente (grande) para suavizar la interfaz.

border-radius: 1.5rem (24px) para tarjetas principales.

border-radius: 0.75rem (12px) para componentes internos y botones.

Iluminación por Capas (Glow & Sombra): El color de acento debe usarse como luz (brillo/halo) sobre las superficies oscuras, creando profundidad.

2. Paleta de Colores y Gestión de Estados (Noche vs. Día) Aquí es donde definimos el alma del sitio. La consistencia entre los modos es crucial.

A. Vista Nocturna (Premium Dark Mode) \- Por Defecto Regla General: El modo oscuro es la identidad principal. El fondo es un "azul casi negro" profundo, no un negro absoluto, para reducir la fatiga visual.

Categoría	Nombre	Hex	Uso y Reglas de Aplicación Fondo Base	Deep Space	\#0B0E14	El fondo principal de la página. (Cuerpo, Section) Superficie	Card Surface	\#1A1D24	El fondo de todas las tarjetas Bento. Debe tener un ligero degradado lineal hacia abajo. Acento	Cyber Neon	\#00E0FF	La Joya. Solo para: bordes activos, enlaces de menú activos, botones "Leer más", estado "LIVE" parpadeante (ver image\_1.png). Texto Primario	Pure White	\#FFFFFF	Titulares y texto principal. Texto Secundario	Misty Gray	\#8A94A8	Texto de cuerpo, subtítulos, captions de tiempo. Estado Éxito	Victory Green	\#4ADE80	Para equipos ganadores en gráficos de estadísticas. Estado Alerta	Alert Orange	\#F97316	Para noticias de "BREAKING NEWS". B. Vista Diurna (Clean Day Mode) \- Alternativo Regla General: El modo claro debe ser refrescante, no deslumbrante. El color de acento neón se suaviza para mantener la legibilidad contra un fondo claro, pero mantiene su identidad de color.

Categoría	Nombre	Hex	Uso y Reglas de Aplicación Fondo Base	Studio White	\#F8FAFC	El fondo principal de la página. (Cuerpo) Superficie	Card Studio	\#FFFFFF	El fondo de todas las tarjetas Bento. Debe tener una sombra muy sutil (drop-shadow: 0 4px 6px rgba(0,0,0,0.05)). Acento	Ocean Blue	\#0284C7	La Joya. El cian neón se oscurece para ser legible, pero mantiene el tono azul cielo. Texto Primario	Onyx Black	\#111827	Titulares y texto principal. Texto Secundario	River Gray	\#4B5563	Texto de cuerpo y subtítulos. Estado Éxito	Victory Green (L)	\#15803D	El verde de éxito se oscurece. Estado Alerta	Alert Orange (L)	\#C2410C	El naranja de alerta se oscurece. 3\. Tipografía (El "Pulse" Tipográfico) Usaremos una familia sans-serif moderna, con excelente legibilidad y pesos variados. Se sugiere la familia Inter (vía Google Fonts) o una fuente Display especializada para titulares.

Tipografía de Título (H1, H2): Inter, peso: Bold (700) o ExtraBold (800).

letter-spacing: \-0.05em; para títulos grandes y compactos.

Tipografía de Cuerpo (Body): Inter, peso: Regular (400) o Medium (500).

line-height: 1.6; para lectura prolongada.

Jerarquía de Escala (Responsive) Nivel	Tamaño (Rem)	Tamaño (px)	Uso H1	3.5rem	56px	Títulos de Noticias Principales (Premium). Ver image\_0.png. H2	2.25rem	36px	Títulos de Tarjetas Secundarias, Nombres de Equipos grandes. H3	1.5rem	24px	Títulos de Sección (ej: "Lakers Struggle"). Body	1.125rem	18px	Texto de cuerpo principal y noticias. Caption	0.875rem	14px	Tiempo de partido, etiquetas pequeñas, descripciones internas de Bento. 4\. Componentes y Reglas UI Esta sección define cómo deben "comportarse" los elementos visuales basándonos en tus capturas.

A. Bento Grid (The Layout) El espaciado entre tarjetas (gap) debe ser consistente.

Gap Escala: Usar escala de 4px (gap-1 a gap-16 en Tailwind).

Valor por Defecto: gap-6 (24px) para el espaciado entre Bento Cards principales.

B. Neon Borders (El Efecto Signature) No todas las tarjetas tienen borde de neón. El borde neón es un Estado Activo o Premio.

Regla: Solo la noticia principal ("Premium") y los elementos con interacción (como un reproductor de video activo o un marcador parpadeante) reciben el borde neón con un halo suave (glow).

Implementación (Noche): border: 2px solid \#00E0FF; box-shadow: 0 0 15px rgba(0, 224, 255, 0.4);

C. Botones Mantenemos el estilo de botones de image\_0.png.

Primary Button: Fondo transparente, borde Cyber Neon, Texto Cyber Neon. Radio de borde: 0.75rem. Al hacer hover, se rellena con Cyber Neon y texto en Deep Space.

D. Visualización en Vivo (Live Scores & Stats) Score Ticker (image\_0.png): Debe tener un fondo sutilmente degradado para separarse del fondo de la página. Usar iconos de equipo nítidos y redondos.

Estado LIVE (image\_1.png): Un punto o una onda parpadeante en color Cyber Neon para partidos activos.

5. Tono de Voz y Contenido (Microcopy) Para que el sitio se vea profesional, el contenido debe coincidir con la estética.

Tono: Energético, directo, basado en datos, imparcial pero apasionado.

Titulares: Cortos, punchy, centrados en el drama o la dominancia (ej: "City's Dominance Challenged").

No amontonar: Priorizar la jerarquía visual sobre la cantidad de texto.

