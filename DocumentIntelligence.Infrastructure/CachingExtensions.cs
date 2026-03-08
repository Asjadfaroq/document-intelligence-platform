using System;
using DocumentIntelligence.Application;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StackExchange.Redis;

namespace DocumentIntelligence.Infrastructure;

public static class CachingServiceCollectionExtensions
{
    /// <summary>
    /// Returns the Redis connection string if configured; otherwise null.
    /// </summary>
    public static string? GetRedisConnectionString(this IConfiguration config)
    {
        var redis = config.GetConnectionString("Redis")
            ?? config["Redis:Configuration"]
            ?? config["Redis__Configuration"];
        return string.IsNullOrWhiteSpace(redis) ? null : redis.Trim();
    }

    /// <summary>
    /// Registers Redis cache and Redis refresh token store when Redis is configured;
    /// otherwise in-memory cache and PostgreSQL refresh token store.
    /// </summary>
    public static IServiceCollection AddDocumentIntelligenceCaching(this IServiceCollection services, IConfiguration config)
    {
        var redis = config.GetRedisConnectionString();
        if (!string.IsNullOrWhiteSpace(redis))
        {
            var options = ParseRedisConnection(redis);
            services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(options));
            services.AddSingleton<ICacheService, RedisCacheService>();
            services.AddScoped<IRefreshTokenStore, RedisRefreshTokenStore>();
            services.AddSingleton<IRateLimitService, RedisRateLimitService>();
        }
        else
        {
            services.AddMemoryCache();
            services.AddSingleton<ICacheService, InMemoryCacheService>();
            services.AddSingleton<IRateLimitService, NoOpRateLimitService>();
        }
        return services;
    }

    private static ConfigurationOptions ParseRedisConnection(string value)
    {
        if (value.StartsWith("redis://", StringComparison.OrdinalIgnoreCase) ||
            value.StartsWith("rediss://", StringComparison.OrdinalIgnoreCase))
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Host is null)
                throw new ArgumentException("Invalid Redis URL.", nameof(value));
            var userInfo = uri.UserInfo?.Split(':', 2);
            var password = userInfo is { Length: 2 } ? userInfo[1] : uri.UserInfo;
            var port = uri.Port > 0 ? uri.Port : 6379;
            var options = ConfigurationOptions.Parse($"{uri.Host}:{port}");
            options.Password = password;
            options.Ssl = uri.Scheme.Equals("rediss", StringComparison.OrdinalIgnoreCase) || value.StartsWith("rediss://", StringComparison.OrdinalIgnoreCase);
            options.AbortOnConnectFail = false;
            if (options.Ssl == false && (value.Contains("upstash.io", StringComparison.OrdinalIgnoreCase)))
                options.Ssl = true;
            return options;
        }
        var opts = ConfigurationOptions.Parse(value);
        opts.AbortOnConnectFail = false;
        return opts;
    }
}
