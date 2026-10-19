/* host.c: a host in plain C, using nothing but pigeon.h and libpigeon.
 *
 *   clang -std=c11 -Wall -Wextra -Werror -Iinclude examples/host.c -L<lib dir> -lpigeon -Wl,-rpath,<lib dir> -o host
 *
 *   host --no-model --config <engine.json> --good <file> --refused <file>
 *   host --config <engine.json> --good <file> --refused <file> \
 *        --nest <patch.nest> --grounded <file> --base <file> --picture <png>
 *
 * Steps 1-3 load no model. With the nest given it goes on through 4-10:
 * Pen streaming through a callback, Peek with a picture and a follow-up
 * without one, the trained planner with host values, a cancelled answer, an
 * ask drained with pigeon_poll, two asks at once, then info, unload, free.
 * Every Pigeon loaded must prove its prompt_check (INTERFACE.md §5.3).
 * Exits 0 only if every step did what it should.
 */
#include "pigeon.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int failures = 0;
#define EXPECT(cond, what) do { if (!(cond)) { printf("   FAILED: %s\n", what); failures++; } } while (0)

/* ── a little JSON reading: enough for events, not a parser ──────────── */

static int has_type(const char *ev, const char *type) {
    char want[64];
    snprintf(want, sizeof want, "\"type\":\"%s\"", type);
    return ev && strstr(ev, want) != NULL;
}

static int is_final(const char *ev) {
    return has_type(ev, "loaded") || has_type(ev, "refused") || has_type(ev, "answer") || has_type(ev, "fetched") || has_type(ev, "error");
}

/* The last `"key":<number>` in an event. */
static unsigned long long number_of(const char *ev, const char *key) {
    char want[64];
    snprintf(want, sizeof want, "\"%s\":", key);
    unsigned long long n = 0;
    for (const char *p = ev; (p = strstr(p, want)) != NULL; p += strlen(want)) {
        const char *v = p + strlen(want);
        if (*v >= '0' && *v <= '9') n = strtoull(v, NULL, 10);
    }
    return n;
}

/* The first `"key":"<string>"`, unescaped into a new string (free it). */
static char *string_of(const char *ev, const char *key) {
    char want[64];
    snprintf(want, sizeof want, "\"%s\":\"", key);
    const char *p = ev ? strstr(ev, want) : NULL;
    if (!p) return NULL;
    p += strlen(want);
    char *out = malloc(strlen(p) + 1), *o = out;
    while (*p && *p != '"') {
        if (*p != '\\') { *o++ = *p++; continue; }
        p++;
        switch (*p) {
        case 'n': *o++ = '\n'; p++; break;
        case 't': *o++ = '\t'; p++; break;
        case 'r': p++; break;
        case 'u': {
            unsigned c = (unsigned)strtoul((char[5]){ p[1], p[2], p[3], p[4], 0 }, NULL, 16);
            p += 5;
            if (c < 0x80) *o++ = (char)c;
            else if (c < 0x800) { *o++ = (char)(0xC0 | (c >> 6)); *o++ = (char)(0x80 | (c & 0x3F)); }
            else { *o++ = (char)(0xE0 | (c >> 12)); *o++ = (char)(0x80 | ((c >> 6) & 0x3F)); *o++ = (char)(0x80 | (c & 0x3F)); }
            break;
        }
        default: *o++ = *p++; break;
        }
    }
    *o = 0;
    return out;
}

/* A slice of an event for printing: `"key":` and what follows, to its end. */
static void print_value(const char *ev, const char *key, int max) {
    char want[64];
    snprintf(want, sizeof want, "\"%s\":", key);
    const char *p = ev ? strstr(ev, want) : NULL;
    if (!p) { printf("(no %s)", key); return; }
    p += strlen(want);
    int depth = 0, n = 0, in_str = 0;
    for (const char *q = p; *q && n < max; q++, n++) {
        if (in_str) { if (*q == '\\') { putchar(*q++); n++; } else if (*q == '"') in_str = 0; }
        else if (*q == '"') in_str = 1;
        else if (*q == '{' || *q == '[') depth++;
        else if (*q == '}' || *q == ']') { if (depth == 0) break; depth--; }
        else if (*q == ',' && depth == 0) break;
        putchar(*q);
        if (!in_str && depth == 0 && (*q == '}' || *q == ']')) break;
    }
    if (n >= max) printf("…");
}

static void dump(const char *label, const char *ev, int max) {
    printf("   %s %.*s%s\n", label, max, ev, (int)strlen(ev) > max ? "…" : "");
}

/* ── waiting for a request, with its events coming by callback ─────────── */

typedef struct {
    pthread_mutex_t mu;
    pthread_cond_t cv;
    int pieces;
    int print_pieces;
    char *final; /* the final event, copied: the engine's string dies with the call */
} wait_t;

static void wait_init(wait_t *w, int print_pieces) {
    pthread_mutex_init(&w->mu, NULL);
    pthread_cond_init(&w->cv, NULL);
    w->pieces = 0;
    w->print_pieces = print_pieces;
    w->final = NULL;
}

static void wait_done(wait_t *w) {
    free(w->final);
    pthread_mutex_destroy(&w->mu);
    pthread_cond_destroy(&w->cv);
}

static void on_event(void *user, const char *ev) {
    wait_t *w = user;
    pthread_mutex_lock(&w->mu);
    if (has_type(ev, "piece")) {
        w->pieces++;
        if (w->print_pieces) {
            char *t = string_of(ev, "text");
            printf("%s", t ? t : "");
            fflush(stdout);
            free(t);
        }
    } else if (is_final(ev) && !w->final) {
        w->final = strdup(ev);
    }
    pthread_cond_broadcast(&w->cv);
    pthread_mutex_unlock(&w->mu);
}

static const char *wait_final(wait_t *w) {
    pthread_mutex_lock(&w->mu);
    while (!w->final) pthread_cond_wait(&w->cv, &w->mu);
    pthread_mutex_unlock(&w->mu);
    return w->final;
}

static void wait_pieces(wait_t *w, int n) {
    pthread_mutex_lock(&w->mu);
    while (w->pieces < n && !w->final) pthread_cond_wait(&w->cv, &w->mu);
    pthread_mutex_unlock(&w->mu);
}

/* Load a file (or a nest member) and prove its prompt_check. 0 on failure. */
static uint64_t load(pigeon_engine *e, const char *path, const char *member) {
    char req[2048];
    if (member) snprintf(req, sizeof req, "{\"path\":\"%s\",\"member\":\"%s\"}", path, member);
    else snprintf(req, sizeof req, "{\"path\":\"%s\"}", path);
    wait_t w;
    wait_init(&w, 0);
    uint64_t r = pigeon_load(e, req, on_event, &w);
    const char *ev = wait_final(&w);
    uint64_t pigeon = has_type(ev, "loaded") ? number_of(ev, "pigeon") : 0;
    char *id = string_of(ev, "id");
    printf("   load %s (request %llu): ", member ? member : path, (unsigned long long)r);
    if (pigeon) {
        int unchecked = strstr(ev, "prompt_unchecked") != NULL;
        printf("loaded as Pigeon %llu, id %s, prompt_check %s\n", (unsigned long long)pigeon, id ? id : "?", unchecked ? "NOT CHECKED" : "proven");
        EXPECT(!unchecked, "every Pigeon asked must prove its prompt_check");
    } else {
        printf("\n");
        dump("not loaded:", ev, 400);
        EXPECT(0, "load");
    }
    free(id);
    wait_done(&w);
    return pigeon;
}

static unsigned char *read_file(const char *path, size_t *len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    unsigned char *b = malloc((size_t)n);
    *len = fread(b, 1, (size_t)n, f);
    fclose(f);
    return b;
}

static double now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

/* Ask and wait, printing the answer. Returns the final event (caller frees). */
static char *ask_and_wait(pigeon_engine *e, const char *req, const pigeon_bytes *att, size_t n_att, int stream) {
    wait_t w;
    wait_init(&w, stream);
    uint64_t r = pigeon_ask(e, req, att, n_att, on_event, &w);
    if (stream) printf("   request %llu, streaming: ", (unsigned long long)r);
    char *final = strdup(wait_final(&w));
    if (stream) printf("\n   (%d pieces)\n", w.pieces);
    wait_done(&w);
    return final;
}

static void print_answer(const char *ev) {
    printf("   answer: kind ");
    print_value(ev, "kind", 40);
    printf(", stopped ");
    print_value(ev, "stopped", 20);
    printf(", value ");
    print_value(ev, "value", 600);
    printf("\n   stats ");
    print_value(ev, "stats", 200);
    printf("\n");
}

/* E24: a callback that tries to free the engine it is called from. */
typedef struct { pigeon_engine *e; int returned; } free_try_t;
static void free_from_callback(void *user, const char *ev) {
    (void)ev;
    free_try_t *t = user;
    pigeon_engine_free(t->e); /* must return at once, freeing nothing */
    t->returned = 1;
}

/* A request that failed before it had a number: request 0 (E23). */
static void zero_event(void *user, const char *ev) {
    char *out = user;
    snprintf(out, 512, "%s", ev);
}

static const char *arg(int argc, char **argv, const char *name) {
    for (int i = 1; i + 1 < argc; i++)
        if (strcmp(argv[i], name) == 0) return argv[i + 1];
    return NULL;
}

int main(int argc, char **argv) {
    int no_model = argc > 1 && strcmp(argv[1], "--no-model") == 0;
    const char *config_path = arg(argc, argv, "--config"), *good = arg(argc, argv, "--good"), *refused = arg(argc, argv, "--refused");
    const char *nest = arg(argc, argv, "--nest"), *grounded = arg(argc, argv, "--grounded"), *base = arg(argc, argv, "--base"), *picture = arg(argc, argv, "--picture");
    if (!config_path || !good || !refused || (!no_model && (!nest || !grounded || !base || !picture))) {
        fprintf(stderr, "usage: see the top of host.c\n");
        return 2;
    }
    setvbuf(stdout, NULL, _IOLBF, 0);

    /* 1 */
    printf("1. pigeon_version: %s\n", pigeon_version());
    EXPECT(strncmp(pigeon_version(), "libpigeon 0.1.0 (llama.cpp ", 27) == 0 && strstr(pigeon_version(), "; spec 1; prefix-cache 2048)"), "the version string names the default prefix cache (E26)");

    /* 2 */
    printf("2. engine from a bad config, then a good one\n");
    char *err = NULL;
    pigeon_engine *bad = pigeon_engine_new("{\"backend\":\"cuda\",\"parallel\":2}", &err);
    printf("   bad config → engine %s, error_json %s\n", bad ? "MADE" : "NULL", err ? err : "(none)");
    EXPECT(!bad && err && strstr(err, "\"code\":\"bad_request\""), "a bad config is refused with an error JSON");
    pigeon_string_free(err);
    err = NULL;
    pigeon_engine *off = pigeon_engine_new("{\"downloads\":true}", &err);
    printf("   downloads on → engine %s, error_json %s\n", off ? "MADE" : "NULL", err ? err : "(none)");
    EXPECT(!off && err && strstr(err, "no downloader"), "E22: downloads on is refused");
    pigeon_string_free(err);
    err = NULL;
    size_t clen = 0;
    char *config = (char *)read_file(config_path, &clen);
    if (!config) { fprintf(stderr, "cannot read %s\n", config_path); return 2; }
    config = realloc(config, clen + 1);
    config[clen] = 0;
    pigeon_engine *e = pigeon_engine_new(config, &err);
    free(config);
    printf("   good config → engine %s\n", e ? "made" : err);
    EXPECT(e != NULL, "the good config makes an engine");
    pigeon_string_free(err);
    if (!e) return 1;

    /* 3 */
    printf("3. pigeon_check, no model loaded\n");
    char req[4096];
    snprintf(req, sizeof req, "{\"path\":\"%s\"}", good);
    char *rep = pigeon_check(e, req);
    printf("   %s: result ", good);
    print_value(rep, "result", 40);
    printf(", base_match ");
    print_value(rep, "base_match", 40);
    printf(", self_test ");
    print_value(rep, "self_test", 40);
    printf("\n");
    EXPECT(strstr(rep, "\"result\":\"accepted\"") != NULL, "the good file is accepted");
    pigeon_string_free(rep);
    snprintf(req, sizeof req, "{\"path\":\"%s\"}", refused);
    rep = pigeon_check(e, req);
    printf("   %s: result ", refused);
    print_value(rep, "result", 40);
    printf(", code ");
    print_value(rep, "code", 40);
    printf("\n   needs ");
    print_value(rep, "needs", 800);
    printf("\n");
    EXPECT(strstr(rep, "\"code\":\"wrong_base\"") && strstr(rep, "\"needs\":"), "the refused file is wrong_base, with its needs");
    pigeon_string_free(rep);
    /* E22: a fetch ends at once with downloads_off. */
    {
        wait_t w;
        wait_init(&w, 0);
        uint64_t r = pigeon_fetch(e, "{\"registry_id\":\"qwen3-vl-2b-instruct\",\"file\":\"Qwen3VL-2B-Instruct-Q4_K_M.gguf\"}", on_event, &w);
        const char *ev = wait_final(&w);
        printf("   pigeon_fetch (request %llu) → %s\n", (unsigned long long)r, ev);
        EXPECT(has_type(ev, "error") && strstr(ev, "downloads_off"), "E22: fetch answers downloads_off");
        wait_done(&w);
    }
    /* A request that is not JSON still gets a number and one final event. */
    {
        wait_t w;
        wait_init(&w, 0);
        uint64_t r = pigeon_ask(e, "not json", NULL, 0, on_event, &w);
        const char *ev = wait_final(&w);
        printf("   pigeon_ask(\"not json\") (request %llu) → %s\n", (unsigned long long)r, ev);
        EXPECT(r > 0 && strstr(ev, "bad_request"), "a request that is not JSON ends with bad_request");
        wait_done(&w);
    }

    /* E23: no engine at all — 0, and one event with request 0. */
    {
        char seen[512] = "";
        uint64_t r = pigeon_ask(NULL, "{}", NULL, 0, zero_event, seen);
        printf("   pigeon_ask(NULL engine) → request %llu, event %s\n", (unsigned long long)r, seen);
        EXPECT(r == 0 && strstr(seen, "\"request\":0") && strstr(seen, "bad_request"), "a NULL engine gives request 0 and one error");
    }
    /* E24: freeing from inside a callback returns at once and frees nothing. */
    {
        free_try_t t = { e, 0 };
        pigeon_fetch(e, "{}", free_from_callback, &t);
        char *still = pigeon_info(e);
        printf("   pigeon_engine_free from inside a callback → returned %s; the engine still answers info: %s\n", t.returned ? "at once" : "NEVER", strstr(still, "\"version\"") ? "yes" : "no");
        EXPECT(t.returned && strstr(still, "\"version\"") != NULL, "E24: free inside a callback returns and frees nothing");
        pigeon_string_free(still);
    }

    if (no_model) {
        pigeon_engine_free(e);
        printf("%s (steps 1-3, no model)\n", failures ? "FAILED" : "PASSED");
        return failures ? 1 : 0;
    }

    /* 4 */
    printf("4. Pen, streaming through the callback\n");
    uint64_t pen = load(e, nest, "pen.pigeon");
    char *ans;
    snprintf(req, sizeof req, "{\"pigeon\":%llu,\"input\":\"In two sentences, why do pigeons bob their heads?\",\"options\":{\"stream\":true}}", (unsigned long long)pen);
    ans = ask_and_wait(e, req, NULL, 0, 1);
    print_answer(ans);
    EXPECT(has_type(ans, "answer") && strstr(ans, "\"kind\":\"text\""), "Pen answers text");
    free(ans);

    /* 5 */
    printf("5. Peek with a picture, then a follow-up without one\n");
    uint64_t peek = load(e, nest, "peek.pigeon");
    size_t plen = 0;
    unsigned char *png = read_file(picture, &plen);
    EXPECT(png != NULL, "the picture is readable");
    pigeon_bytes att = { png, plen };
    snprintf(req, sizeof req, "{\"pigeon\":%llu,\"input\":\"What does this say? One line.\",\"picture\":{\"attachment\":0}}", (unsigned long long)peek);
    ans = ask_and_wait(e, req, &att, 1, 0);
    free(png); /* §2: the engine copied it before pigeon_ask returned */
    print_answer(ans);
    EXPECT(has_type(ans, "answer"), "Peek answers the picture");
    char *first = string_of(ans, "raw");
    free(ans);
    /* The follow-up: Peek's history, no picture. */
    char *q = first ? first : strdup("");
    for (char *c = q; *c; c++) if (*c == '"' || *c == '\\' || *c == '\n') *c = ' ';
    snprintf(req, sizeof req, "{\"pigeon\":%llu,\"input\":\"And what is the total?\",\"history\":[{\"user\":\"What does this say? One line.\",\"pigeon\":\"%s\"}]}", (unsigned long long)peek, q);
    ans = ask_and_wait(e, req, NULL, 0, 0);
    printf("   follow-up to Peek, no picture → ");
    if (has_type(ans, "error")) {
        dump("", ans, 300);
        free(ans);
        uint64_t words = load(e, nest, "peek-words.pigeon");
        snprintf(req, sizeof req, "{\"pigeon\":%llu,\"input\":\"And what is the total?\",\"history\":[{\"user\":\"What does this say? One line.\",\"pigeon\":\"%s\"}]}", (unsigned long long)words, q);
        ans = ask_and_wait(e, req, NULL, 0, 0);
        printf("   the same follow-up to Peek without a picture (peek-words), as the app sends it:\n");
    }
    print_answer(ans);
    printf("   history_used ");
    print_value(ans, "history_used", 10);
    printf("\n");
    EXPECT(has_type(ans, "answer") && number_of(ans, "history_used") == 1, "the follow-up answers with its one earlier turn");
    free(ans);
    free(q);

    /* 6 */
    printf("6. the trained planner, with host values and its grammar\n");
    uint64_t planner = load(e, nest, "patch-planner-trained.pigeon");
    snprintf(req, sizeof req,
             "{\"pigeon\":%llu,\"input\":\"TODAY\\n2026-10-14 (Wednesday), timezone UTC, locale en-GB.\\n\\nSKILLS\\n"
             "convertLength — Convert a length from one unit to another.\\n  needs: value: number, from: string, to: string\\n"
             "  e.g. \\\"3 miles in km\\\" → {\\\"value\\\":3,\\\"from\\\":\\\"mi\\\",\\\"to\\\":\\\"km\\\"}\\n"
             "percentOf — Work out a percentage of a number.\\n  needs: percent: number, of: number\\n"
             "  e.g. \\\"15%% of 80\\\" → {\\\"percent\\\":15,\\\"of\\\":80}\\n\\nMESSAGE\\nhow many km is 26.2 miles\","
             "\"values\":{\"steps[].skill\":[\"convertLength\",\"percentOf\"]}}",
             (unsigned long long)planner);
    ans = ask_and_wait(e, req, NULL, 0, 0);
    print_answer(ans);
    printf("   host_values ");
    print_value(ans, "host_values", 200);
    printf("\n");
    EXPECT(has_type(ans, "answer") && strstr(ans, "\"kind\":\"json\"") && strstr(ans, "\"skill\":\"convertLength\""), "the planner plans convertLength as JSON");
    free(ans);

    /* 7 */
    printf("7. a long answer, cancelled\n");
    {
        wait_t w;
        wait_init(&w, 1);
        snprintf(req, sizeof req, "{\"pigeon\":%llu,\"input\":\"Write a long story about a pigeon crossing a city, at least twenty paragraphs.\",\"options\":{\"stream\":true}}", (unsigned long long)pen);
        printf("   streaming: ");
        uint64_t r = pigeon_ask(e, req, NULL, 0, on_event, &w);
        wait_pieces(&w, 8);
        double t0 = now_ms();
        pigeon_cancel(e, r);
        const char *ev = wait_final(&w);
        double took = now_ms() - t0;
        printf("\n   cancelled request %llu after %d pieces; final event in %.0f ms: stopped ", (unsigned long long)r, w.pieces, took);
        print_value(ev, "stopped", 20);
        printf("\n");
        EXPECT(has_type(ev, "answer") && strstr(ev, "\"stopped\":\"cancelled\""), "the final event is the cancelled answer");
        wait_done(&w);
    }

    /* 8 */
    printf("8. one ask drained with pigeon_poll (no callback)\n");
    {
        uint64_t nof = load(e, nest, "pen-no-figures.pigeon");
        snprintf(req, sizeof req, "{\"pigeon\":%llu,\"input\":\"Say hello in five words.\",\"options\":{\"stream\":true}}", (unsigned long long)nof);
        uint64_t r = pigeon_ask(e, req, NULL, 0, NULL, NULL);
        int pieces = 0, done = 0;
        while (!done) {
            char *ev = pigeon_poll(e);
            if (!ev) { usleep(5000); continue; }
            EXPECT(number_of(ev, "request") == r, "a polled event belongs to the polled request");
            if (has_type(ev, "piece")) pieces++;
            if (is_final(ev)) { printf("   request %llu: %d pieces polled, then\n", (unsigned long long)r, pieces); print_answer(ev); EXPECT(has_type(ev, "answer"), "the polled ask answers"); done = 1; }
            pigeon_string_free(ev);
        }
    }

    /* 9 */
    printf("9. two asks at once on different Pigeons (grounded, and a base Pigeon)\n");
    {
        uint64_t g = load(e, grounded, NULL), b = load(e, base, NULL);
        wait_t wg, wb;
        wait_init(&wg, 0);
        wait_init(&wb, 0);
        char rg[512], rb[512];
        snprintf(rg, sizeof rg, "{\"pigeon\":%llu,\"input\":\"How many senators does each state have?\"}", (unsigned long long)g);
        snprintf(rb, sizeof rb, "{\"pigeon\":%llu,\"input\":\"What is a mortgage?\"}", (unsigned long long)b);
        double t0 = now_ms();
        uint64_t r1 = pigeon_ask(e, rg, NULL, 0, on_event, &wg);
        uint64_t r2 = pigeon_ask(e, rb, NULL, 0, on_event, &wb);
        const char *e1 = wait_final(&wg), *e2 = wait_final(&wb);
        printf("   both finished in %.0f ms\n   grounded (request %llu): sections ", now_ms() - t0, (unsigned long long)r1);
        print_value(e1, "sections", 200);
        printf("\n");
        print_answer(e1);
        printf("   base Pigeon (request %llu):\n", (unsigned long long)r2);
        print_answer(e2);
        EXPECT(has_type(e1, "answer") && has_type(e2, "answer"), "both finish with an answer");
        wait_done(&wg);
        wait_done(&wb);
    }

    /* 10 */
    printf("10. info, unload, free\n");
    char *info = pigeon_info(e);
    printf("   info: %s\n", info);
    EXPECT(strstr(info, "; prefix-cache 2048)\"") != NULL, "this engine's own stamp names its prefix-cache setting (E26, D98)");
    EXPECT(strstr(info, "\"bases\":[{") != NULL, "info lists the bases");
    pigeon_string_free(info);
    pigeon_unload(e, pen);
    info = pigeon_info(e);
    printf("   after unloading Pigeon %llu: pigeons ", (unsigned long long)pen);
    print_value(info, "pigeons", 600);
    printf("\n");
    pigeon_string_free(info);
    pigeon_engine_free(e);
    printf("   freed\n");
    printf("%s (steps 1-10)\n", failures ? "FAILED" : "PASSED");
    return failures ? 1 : 0;
}
