package runner

import (
	"math/rand/v2"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/abhishekbhonde/courier/internal/model"
)

var varPattern = regexp.MustCompile(`\{\{\s*([^{}\s]+)\s*\}\}`)

// maxDepth bounds how many times variable values are re-expanded, so that
// self-referencing variables terminate.
const maxDepth = 5

// Resolver substitutes {{name}} placeholders. Later scopes override earlier
// ones, and names starting with "$" are dynamic values generated per use.
type Resolver struct {
	vars    map[string]string
	missing map[string]struct{}
}

// NewResolver builds a resolver from scopes ordered lowest to highest priority
// (e.g. collection variables, then environment variables).
func NewResolver(scopes ...[]model.Variable) *Resolver {
	r := &Resolver{vars: map[string]string{}, missing: map[string]struct{}{}}
	for _, scope := range scopes {
		for _, v := range scope {
			if v.Enabled && v.Key != "" {
				r.vars[v.Key] = v.Value
			}
		}
	}
	return r
}

// Resolve expands every placeholder in s. Unknown names are left as-is and
// recorded for Missing.
func (r *Resolver) Resolve(s string) string {
	return r.resolve(s, 0)
}

func (r *Resolver) resolve(s string, depth int) string {
	if depth > maxDepth {
		return s
	}
	return varPattern.ReplaceAllStringFunc(s, func(m string) string {
		name := varPattern.FindStringSubmatch(m)[1]
		if v, ok := dynamic(name); ok {
			return v
		}
		v, ok := r.vars[name]
		if !ok {
			r.missing[name] = struct{}{}
			return m
		}
		return r.resolve(v, depth+1)
	})
}

// Missing returns the sorted names of variables that could not be resolved.
func (r *Resolver) Missing() []string {
	out := make([]string, 0, len(r.missing))
	for k := range r.missing {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func dynamic(name string) (string, bool) {
	switch name {
	case "$guid", "$uuid", "$randomUUID":
		return model.NewID(), true
	case "$timestamp":
		return strconv.FormatInt(time.Now().Unix(), 10), true
	case "$isoTimestamp":
		return time.Now().UTC().Format(time.RFC3339), true
	case "$randomInt":
		return strconv.Itoa(rand.IntN(1001)), true
	}
	return "", false
}
