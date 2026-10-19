typedef struct pigeon_engine pigeon_engine;
typedef void (*pigeon_event_fn)(void *user, const char *event_json);
typedef struct { const uint8_t *data; size_t len; } pigeon_bytes;

const char    *pigeon_version(void);                                  /* "libpigeon 0.1.0 (llama.cpp <commit>; spec 1; prefix-cache 2048)" */
pigeon_engine *pigeon_engine_new(const char *config_json, char **error_json);
void           pigeon_engine_free(pigeon_engine *);

char    *pigeon_check (pigeon_engine *, const char *request_json);    /* no model; returns a report or refusal */
uint64_t pigeon_load  (pigeon_engine *, const char *request_json, pigeon_event_fn, void *user);
void     pigeon_unload(pigeon_engine *, uint64_t pigeon);
uint64_t pigeon_ask   (pigeon_engine *, const char *request_json,
                       const pigeon_bytes *attachments, size_t n_attachments,
                       pigeon_event_fn, void *user);
void     pigeon_cancel(pigeon_engine *, uint64_t request);
uint64_t pigeon_fetch (pigeon_engine *, const char *request_json, pigeon_event_fn, void *user);
char    *pigeon_info  (pigeon_engine *);                              /* what is loaded, and what it costs */
char    *pigeon_poll  (pigeon_engine *);                              /* next queued event, or NULL */
void     pigeon_string_free(char *);
