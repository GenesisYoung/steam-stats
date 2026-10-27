<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
    <p class="text-6xl font-bold text-accent">404</p>
    <h1 class="text-xl font-semibold">{{ $t('notFound.title') }}</h1>
    <RouterLink to="/" class="btn btn-primary">{{ $t('notFound.home') }}</RouterLink>
  </div>
</template>
