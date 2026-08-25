# Example Makefile for simple_make_enhanced
# Demonstrates enhanced features: .PHONY, conditionals, functions

CC ?= cc
CFLAGS := -O2 -Wall

# Source discovery using wildcard
SOURCES := $(wildcard *.c)
OBJECTS := $(patsubst %.c,%.o,$(SOURCES))

# Feature toggles
USE_DEBUG ?= 0

ifeq ($(USE_DEBUG),1)
CFLAGS += -g -DDEBUG
endif

# Targets
.PHONY: all clean info

all: hello

hello: $(OBJECTS)
	$(CC) $(CFLAGS) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

info:
	@echo "CC       = $(CC)"
	@echo "CFLAGS   = $(CFLAGS)"
	@echo "SOURCES  = $(SOURCES)"
	@echo "OBJECTS  = $(OBJECTS)"

clean:
	rm -f $(OBJECTS) hello
