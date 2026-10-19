/* pigeon.h: libpigeon, the engine that does what a .pigeon file says.
 *
 * The whole public surface is INTERFACE.md §2: twelve functions, JSON in,
 * JSON events out, one handle, nothing blocks. The declarations below are
 * §2's, token for token; tests/header.rs fails if either side changes alone.
 *
 * Rules (§2): strings are UTF-8 and NUL-terminated; every char * returned is
 * freed with pigeon_string_free (pigeon_version's is not: it is static); a
 * string passed to a callback is valid only during that call; any function
 * may be called from any thread; attachments are copied before pigeon_ask
 * returns; unknown JSON keys are ignored both ways. pigeon_engine_free must
 * not be called from inside a callback (E24). See HOST-GUIDE.md.
 */
#ifndef PIGEON_H
#define PIGEON_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

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

#ifdef __cplusplus
}
#endif

#endif /* PIGEON_H */
