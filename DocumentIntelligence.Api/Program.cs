using System.Linq;
using System.Text;
using DocumentIntelligence.Application;
using DocumentIntelligence.Infrastructure;
using DocumentIntelligence.Api;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Polly;
using Polly.Extensions.Http;
using StackExchange.Redis;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Serilog: enrichers (CorrelationId from LogContext in middleware), machine, environment
builder.Host.UseSerilog((ctx, cfg) =>
{
    cfg
        .ReadFrom.Configuration(ctx.Configuration)
        .Enrich.FromLogContext()
        .Enrich.WithProperty("Application", "DocumentIntelligence.Api")
        .Enrich.WithMachineName()
        .Enrich.WithEnvironmentName();
    if (ctx.HostingEnvironment.IsDevelopment())
        cfg.WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {CorrelationId} {Message:lj}{NewLine}{Exception}");
    else
        cfg.WriteTo.Console();
});
builder.Services.AddSerilog();

builder.Services.AddOpenApi();

// CORS: allow only explicitly configured origins (no wildcards). Production sets CORS__AllowedOrigins__0, etc. via env.
builder.Services.AddCors(options =>
{
    options.AddPolicy("WebClient", policy =>
    {
        policy
            .SetIsOriginAllowed(origin =>
            {
                if (string.IsNullOrWhiteSpace(origin) || !Uri.TryCreate(origin, UriKind.Absolute, out var uri) || !uri.IsAbsoluteUri)
                    return false;

                // Require HTTPS in production for non-localhost origins (security)
                var env = builder.Environment;
                if (!uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) &&
                    !uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                var allowedHosts = builder.Configuration
                    .GetSection("CORS:AllowedOrigins")
                    .Get<string[]>()
                    ?? Array.Empty<string>();

                if (allowedHosts.Length > 0)
                {
                    // Strict: only origins whose host is in the whitelist (case-insensitive)
                    return allowedHosts.Any(h => string.Equals(h?.Trim(), uri.Host, StringComparison.OrdinalIgnoreCase));
                }

                // No origins configured: in Development allow localhost only; in Production allow none (must set env)
                if (env.IsDevelopment())
                {
                    return uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                        || uri.Host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase);
                }

                return false;
            })
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("OwnerOrAdmin", policy =>
        policy.RequireRole("Owner", "Admin"));
    options.AddPolicy("TenantUser", policy =>
        policy.RequireRole("Owner", "Admin", "Member"));
});

// Lightweight HttpClient for dependency health checks
builder.Services.AddHttpClient("health-check");

var connectionString = builder.Configuration.GetConnectionString("Default");

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql =>
    {
        npgsql.UseVector();
        // Enable built-in transient failure retries for PostgreSQL
        npgsql.EnableRetryOnFailure(
            maxRetryCount: 3,
            maxRetryDelay: TimeSpan.FromSeconds(5),
            errorCodesToAdd: null);
    }));

builder.Services.AddDocumentIntelligenceCaching(builder.Configuration);
builder.Services.AddScoped<IWorkspaceAccessService, WorkspaceAccessService>();
builder.Services.AddScoped<ITenantOverviewProvider, TenantOverviewProvider>();
builder.Services.AddScoped<IApplicationDbContext>(sp => sp.GetRequiredService<ApplicationDbContext>());
builder.Services.AddScoped<IVectorSearchService, VectorSearchService>();
builder.Services.AddScoped<IPasswordHasher, PasswordHasher>();
builder.Services.AddScoped<IJwtTokenGenerator, JwtTokenGenerator>();
if (string.IsNullOrWhiteSpace(builder.Configuration.GetRedisConnectionString()))
    builder.Services.AddScoped<IRefreshTokenStore, RefreshTokenStore>();
builder.Services.AddHttpClient<IStorageService, SupabaseStorageService>();
builder.Services.AddHttpClient<IEmbeddingService, HuggingFaceEmbeddingService>()
    .AddPolicyHandler(HttpClientPolicies.CreateRetryPolicy("hf-embedding"));
builder.Services.AddHttpClient<ILLMClient, HuggingFaceLLMClient>()
    .AddPolicyHandler(HttpClientPolicies.CreateRetryPolicy("hf-llm"));
builder.Services.AddSingleton<IIngestionQueue, InMemoryIngestionQueue>();
builder.Services.AddHostedService<DocumentIngestionWorker>();

builder.Services.AddMediatR(cfg =>
{
    cfg.RegisterServicesFromAssembly(typeof(RegisterTenantAndOwnerCommand).Assembly);
});

var jwtSecret = builder.Configuration["Jwt:Secret"] ?? builder.Configuration["Jwt__Secret"];
var hasJwtAuth = !string.IsNullOrWhiteSpace(jwtSecret);
if (hasJwtAuth)
{
    var key = Encoding.UTF8.GetBytes(jwtSecret);

    builder.Services.AddAuthentication(options =>
        {
            options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
            options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        })
        .AddJwtBearer(options =>
        {
            var clockSkewSeconds = 30;
            var skewConfig = builder.Configuration["Jwt:ClockSkewSeconds"] ?? builder.Configuration["Jwt__ClockSkewSeconds"];
            if (!string.IsNullOrWhiteSpace(skewConfig) && int.TryParse(skewConfig, out var parsed) && parsed >= 0)
                clockSkewSeconds = Math.Min(parsed, 300);
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidateAudience = true,
                ValidateIssuerSigningKey = true,
                ValidIssuer = "document-intelligence",
                ValidAudience = "document-intelligence",
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ClockSkew = TimeSpan.FromSeconds(clockSkewSeconds)
            };
            options.Events = new Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents
            {
                OnMessageReceived = ctx =>
                {
                    var token = ctx.Request.Cookies["di_access"];
                    if (!string.IsNullOrEmpty(token)) ctx.Token = token;
                    return Task.CompletedTask;
                }
            };
        });
}

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<ExceptionLoggingMiddleware>();
app.UseSerilogRequestLogging(options =>
{
    options.MessageTemplate = "HTTP {RequestMethod} {RequestPath} => {StatusCode}";
    options.EnrichDiagnosticContext = (diagnosticContext, httpContext) =>
    {
        if (httpContext.Items.TryGetValue(CorrelationIdMiddleware.CorrelationIdItemKey, out var correlationId))
            diagnosticContext.Set("CorrelationId", correlationId);
    };
});
app.UseCors("WebClient");
if (hasJwtAuth)
    app.UseAuthentication();
app.UseHttpsRedirection();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapGet("/health/deep", async (
    ApplicationDbContext db,
    IServiceProvider services,
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    CancellationToken ct) =>
{
    var results = new Dictionary<string, object?>();

    // Database check
    try
    {
        var canConnect = await db.Database.CanConnectAsync(ct);
        results["database"] = new { status = canConnect ? "healthy" : "unhealthy" };
    }
    catch (Exception ex)
    {
        results["database"] = new { status = "unhealthy", error = ex.Message };
    }

    // Redis check (only when configured)
    var redisConnString = config.GetRedisConnectionString();
    if (string.IsNullOrWhiteSpace(redisConnString))
    {
        results["redis"] = new { status = "disabled" };
    }
    else
    {
        try
        {
            var mux = services.GetService<IConnectionMultiplexer>();
            if (mux == null)
            {
                results["redis"] = new { status = "unhealthy", error = "ConnectionMultiplexer not registered" };
            }
            else
            {
                var dbRedis = mux.GetDatabase();
                var pong = await dbRedis.PingAsync();
                results["redis"] = new { status = "healthy", latencyMs = pong.TotalMilliseconds };
            }
        }
        catch (Exception ex)
        {
            results["redis"] = new { status = "unhealthy", error = ex.Message };
        }
    }

    var client = httpClientFactory.CreateClient("health-check");
    client.Timeout = TimeSpan.FromSeconds(3);

    // Supabase reachability
    var supabaseUrl = (config["SUPABASE_URL"] ?? string.Empty).Trim();
    if (string.IsNullOrWhiteSpace(supabaseUrl))
    {
        results["supabase"] = new { status = "disabled" };
    }
    else
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Head, supabaseUrl);
            var response = await client.SendAsync(request, ct);
            results["supabase"] = new
            {
                status = response.IsSuccessStatusCode ? "healthy" : "degraded",
                httpStatus = (int)response.StatusCode
            };
        }
        catch (Exception ex)
        {
            results["supabase"] = new { status = "unhealthy", error = ex.Message };
        }
    }

    // Hugging Face reachability (router base)
    var hfApiKey = (config["HUGGINGFACE_API_KEY"] ?? string.Empty).Trim();
    if (string.IsNullOrWhiteSpace(hfApiKey))
    {
        results["huggingface"] = new { status = "disabled" };
    }
    else
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://router.huggingface.co/health");
            request.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", hfApiKey);
            var response = await client.SendAsync(request, ct);
            results["huggingface"] = new
            {
                status = response.IsSuccessStatusCode ? "healthy" : "degraded",
                httpStatus = (int)response.StatusCode
            };
        }
        catch (Exception ex)
        {
            results["huggingface"] = new { status = "unhealthy", error = ex.Message };
        }
    }

    var overallHealthy = results.Values.All(v =>
    {
        if (v is not IDictionary<string, object?> dict) return true;
        return dict.TryGetValue("status", out var s) && (string?)s is "healthy" or "disabled";
    });

    return Results.Json(new
    {
        status = overallHealthy ? "healthy" : "degraded",
        checks = results
    });
});

app.MapGet("/metrics/basic", async (ApplicationDbContext db, CancellationToken ct) =>
{
    var documentsCount = await db.Documents.CountAsync(ct);
    var questionsCount = await db.Questions.CountAsync(ct);
    return Results.Ok(new { documentsCount, questionsCount });
})
.RequireAuthorization("OwnerOrAdmin");

app.MapAuth();
app.MapTenant();
app.MapWorkspaces();
app.MapDocuments();
app.MapAsk();
app.MapAdmin();

app.Run();
