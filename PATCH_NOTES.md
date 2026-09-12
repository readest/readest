# Piper TTS embarqué (Android) — patch

Ajoute un moteur TTS neuronal Piper 100% embarqué/hors-ligne sur Android, via
sherpa-onnx, en plus du "System TTS" existant.

## Comment appliquer

Ce zip reflète exactement l'arborescence de `apps/readest-app/` dans le repo
Readest. Copie chaque fichier au même chemin dans ton clone :

- **Nouveau** : tout `src-tauri/plugins/tauri-plugin-piper-tts/**` et tout
  `src/services/tts/providers/piper*.ts` + `src/services/tts/PiperTTSClient.ts`
  → copie directement, rien n'existe encore à ces chemins.
- **Modifié** (3 fichiers existants, diff petit et localisé) :
  - `src-tauri/Cargo.toml` — une ligne ajoutée (dépendance de chemin vers le
    plugin).
  - `src-tauri/src/lib.rs` — une ligne ajoutée (`.plugin(tauri_plugin_piper_tts::init())`).
  - `src-tauri/capabilities/default.json` — une ligne ajoutée (`"piper-tts:default"`).
  - `src/services/tts/TTSController.ts` — remplace le fichier existant par
    celui-ci (diff = ajout de `ttsPiperClient`/`ttsPiperVoices` partout où
    `ttsNativeClient`/`ttsNativeVoices` apparaissaient : construction, `init()`,
    `getVoices()`, `setPrimaryLang()`, `setVoice()`, `shutdown()`).

## Ce qui marche déjà, une fois compilé

- Le moteur "Piper TTS (offline)" apparaît dans le sélecteur de voix dès
  qu'au moins une voix est téléchargée (le regroupement par moteur est
  générique — `BufferedTTSClient.getVoices()` — donc aucun changement UI
  n'était nécessaire pour l'afficher).
- Téléchargement/suppression de voix : `ttsController.ttsPiperClient.voiceManager`
  expose `downloadVoice(id)`, `deleteVoice(id)`, `cancelDownload(id)`,
  `onProgress(cb)`. Après un téléchargement, appelle
  `ttsController.ttsPiperClient.refreshVoices()` puis relance `getVoices(lang)`
  pour rafraîchir la liste affichée.
- Cache par livre (comme Edge TTS) : réutilisé automatiquement si le cache
  TTS est activé (`getTTSCacheConfig()`), même si l'intérêt est moindre
  puisque Piper est déjà local et rapide.

## Ce qui reste "manuel" (rien de bloquant)

Rien. Les deux étapes réseau ont été faites :

1. **`.so` natifs** : vendorisés depuis ton upload
   (`sherpa-onnx-v1.13.8-android.tar.bz2`), vérifiés symbole par symbole.
2. **API Kotlin (`Tts.kt`)** : vendorisée depuis ton upload du repo complet
   (`sherpa-onnx/kotlin-api/Tts.kt`), un seul fichier autonome — pas
   `OfflineTts.kt` comme je le pensais au départ, la vraie classe s'appelle
   pareil mais vit dans `Tts.kt`. Les noms de méthodes natives qu'il déclare
   (`newFromFile`, `generateImpl`, `getSampleRate`, etc.) correspondent
   exactement aux symboles JNI que j'avais extraits du binaire à l'étape
   précédente — donc cette version de `Tts.kt` correspond bien à ce `.so`.
3. **URLs de voix** : en creusant le code C++ de sherpa-onnx
   (`offline-tts-vits-model.cc`), j'ai découvert que les fichiers Piper bruts
   de Hugging Face (ceux listés sur la page que tu as donnée) NE
   fonctionneraient PAS tels quels : le loader VITS de sherpa-onnx lit des
   métadonnées (langue, voix...) injectées directement dans le `.onnx` par
   leur script de conversion, absentes des fichiers Piper originaux. La
   bonne source, ce sont leurs propres paquets déjà convertis, hébergés sur
   leurs releases GitHub : `vits-piper-<lang>-<voix>-<qualité>.tar.bz2`
   (contient déjà `model.onnx` + `tokens.txt`). J'ai donc entièrement
   changé la stratégie de téléchargement : le plugin télécharge maintenant
   directement ces archives `.tar.bz2` et les décompresse sur l'appareil
   (nouvelle dépendance Gradle `org.apache.commons:commons-compress`,
   résolue automatiquement depuis Maven Central à la compilation — rien à
   vendoriser). Le fichier `espeak-ng-data` (partagé par toutes les voix)
   est lui aussi téléchargé et décompressé automatiquement au premier
   lancement — plus besoin de l'embarquer en asset.
   `piperVoices.ts` contient maintenant un vrai catalogue (anglais US/UK,
   français, allemand, espagnol, italien, portugais, néerlandais, polonais,
   russe) avec de vraies URLs fonctionnelles.

## Seule vraie inconnue restante

Je n'ai toujours pas pu compiler ni exécuter quoi que ce soit (pas de SDK
Android/NDK/réseau de build ici). Tout est cohérent sur le papier
(signatures Kotlin vérifiées contre le binaire réel, URLs vérifiées via le
code source et la doc officielle), mais un premier `cargo tauri android dev`
réel sur ta machine reste l'étape de vérité.

## Pourquoi cette architecture

Le code existant a un point d'extension propre pour "un nouveau moteur TTS
qui synthétise des blocs audio" : l'interface `SpeechProvider`
(`src/services/tts/providers/types.ts`) + `BufferedTTSClient`, déjà utilisée
par Edge TTS (`EdgeTTSClient extends BufferedTTSClient`). `PiperTTSClient`
suit exactement le même patron : tout le scheduling, le time-stretch, le
suivi des mots, le cache, etc. sont réutilisés gratuitement ; seul
`PiperSpeechProvider.synthesize()` est spécifique à Piper (un appel Tauri
vers le plugin Android qui fait tourner sherpa-onnx et renvoie un WAV).
