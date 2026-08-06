# Forbidden capabilities for Step 4 distractors

These ten capabilities are reserved for the ten Step 5 `no_result` cases. They must be absent from
all distractor metadata and must remain absent from the complete 1,000-record corpus. Authors must
avoid the capability itself, close substitutes, hints, and scanner signatures. Deterministic
matching is a necessary syntax gate; the later independent full-catalog audit remains mandatory.

## FC-01 — Wallet key custody and transaction signing

**Definition.** A service that stores or controls wallet private keys and signs blockchain
transactions or arbitrary wallet payloads on a buyer's behalf.

**Boundary basis.** F13 explicitly excludes generic key management and wallet signing; F1 only
reads chain state, and no other family provides key custody or transaction signing.

**Scanner signatures.** `wallet signing`; `wallet signer`; `transaction signing`; `sign
transaction`; `private key custody`; `key custody`; `custodial key management`.

## FC-02 — Transactional email delivery

**Definition.** An outbound delivery API that sends transactional or bulk email through SMTP or a
managed mail transport.

**Boundary basis.** F20 returns published article feeds and F9 generates text, but neither sends
messages; no family includes email transport or delivery.

**Scanner signatures.** `email delivery`; `send email`; `transactional email`; `outbound email
api`; `smtp relay`; `bulk email`.

## FC-03 — SMS and telephony message delivery

**Definition.** A communications API that sends SMS/text messages or initiates carrier voice calls
to telephone numbers.

**Boundary basis.** F19 analyzes or converts language and F20 exposes article feeds, but no family
delivers messages over telephone networks.

**Scanner signatures.** `sms delivery`; `send sms`; `transactional sms`; `text messaging api`;
`telephony api`; `voice call api`.

## FC-04 — Object storage and file hosting

**Definition.** A managed service that persists, retrieves, hosts, backs up, or restores buyer-owned
files or blobs.

**Boundary basis.** F12 fetches a named public URL and F16 parses supplied documents, but neither
stores or hosts buyer files; no family is a storage service.

**Scanner signatures.** `object storage`; `blob storage`; `file hosting`; `s3 compatible`; `backup
restore`; `managed file storage`.

## FC-05 — Managed relational database queries

**Definition.** A hosted relational database service that executes buyer-supplied SQL or provides
managed PostgreSQL/MySQL data storage.

**Boundary basis.** F1 reads blockchain state and F14 sells precomputed aggregates, while neither
accepts arbitrary SQL or hosts a general relational database; no other family does so.

**Scanner signatures.** `managed sql`; `sql query api`; `execute sql`; `database query api`;
`postgres hosting`; `mysql hosting`; `relational database`.

## FC-06 — Hosted code execution sandbox

**Definition.** A service that compiles or executes buyer-supplied program code inside a hosted or
sandboxed runtime.

**Boundary basis.** F9 may plan tool calls and generate text, but it does not execute programs; none
of the remaining families provides a compiler or general code runtime.

**Scanner signatures.** `code execution`; `execute code`; `run code`; `sandboxed runtime`;
`compiler api`; `code runner`.

## FC-07 — Generative image synthesis

**Definition.** A model endpoint that creates or edits raster images from text prompts, masks, or
reference images.

**Boundary basis.** F11 searches existing images, F16 reads or classifies documents/images, and F9
generates language tokens; none creates or edits images.

**Scanner signatures.** `image generation`; `generate image`; `text to image`; `image synthesis`;
`image editing model`; `diffusion image`.

## FC-08 — Speech-to-text transcription

**Definition.** An audio-processing service that converts spoken audio into a written transcript.

**Boundary basis.** F16 extracts text from documents/images and F19 operates on written language,
but neither accepts speech audio; no family includes automatic speech recognition.

**Scanner signatures.** `speech transcription`; `audio transcription`; `speech to text`; `voice to text`;
`automatic speech recognition`; `asr transcription`; `transcribe audio`.

## FC-09 — Text-to-speech synthesis

**Definition.** An audio-generation service that renders written text as synthetic spoken audio or
a selected voice.

**Boundary basis.** F9 generates text and F19 transforms written language, but no family produces
spoken audio or synthetic voices.

**Scanner signatures.** `text to speech`; `speech synthesis`; `synthetic voice`; `voice
generation`; `tts api`; `generate speech`.

## FC-10 — Video transcoding and streaming packaging

**Definition.** A media-processing service that re-encodes uploaded video or packages it into
streaming renditions such as HLS or adaptive-bitrate outputs.

**Boundary basis.** F12 captures web screenshots and F16 processes documents/images, but no family
encodes video or prepares streaming media.

**Scanner signatures.** `video transcoding`; `transcode video`; `video encoding`; `adaptive
bitrate`; `hls packaging`; `streaming rendition`.

## Machine-readable scanner signatures

`tools/merge-distractors.ts` parses the JSON block between the markers below. Keep the human
sections and this block synchronized; the merger fails if ids, names, or signatures differ.

<!-- FORBIDDEN_SIGNATURES_START -->
```json
[
  {"id":"FC-01","name":"Wallet key custody and transaction signing","signatures":["wallet signing","wallet signer","transaction signing","sign transaction","private key custody","key custody","custodial key management"]},
  {"id":"FC-02","name":"Transactional email delivery","signatures":["email delivery","send email","transactional email","outbound email api","smtp relay","bulk email"]},
  {"id":"FC-03","name":"SMS and telephony message delivery","signatures":["sms delivery","send sms","transactional sms","text messaging api","telephony api","voice call api"]},
  {"id":"FC-04","name":"Object storage and file hosting","signatures":["object storage","blob storage","file hosting","s3 compatible","backup restore","managed file storage"]},
  {"id":"FC-05","name":"Managed relational database queries","signatures":["managed sql","sql query api","execute sql","database query api","postgres hosting","mysql hosting","relational database"]},
  {"id":"FC-06","name":"Hosted code execution sandbox","signatures":["code execution","execute code","run code","sandboxed runtime","compiler api","code runner"]},
  {"id":"FC-07","name":"Generative image synthesis","signatures":["image generation","generate image","text to image","image synthesis","image editing model","diffusion image"]},
  {"id":"FC-08","name":"Speech-to-text transcription","signatures":["speech transcription","audio transcription","speech to text","voice to text","automatic speech recognition","asr transcription","transcribe audio"]},
  {"id":"FC-09","name":"Text-to-speech synthesis","signatures":["text to speech","speech synthesis","synthetic voice","voice generation","tts api","generate speech"]},
  {"id":"FC-10","name":"Video transcoding and streaming packaging","signatures":["video transcoding","transcode video","video encoding","adaptive bitrate","hls packaging","streaming rendition"]}
]
```
<!-- FORBIDDEN_SIGNATURES_END -->
