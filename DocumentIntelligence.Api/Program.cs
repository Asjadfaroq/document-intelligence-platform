using System.Linq;
using System.Text;
using DocumentIntelligence.Application;
using DocumentIntelligence.Infrastructure;
using DocumentIntelligence.Api;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
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

var connectionString = builder.Configuration.GetConnectionString("Default");

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(connectionString, npgsql => npgsql.UseVector()));

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
builder.Services.AddHttpClient<IEmbeddingService, HuggingFaceEmbeddingService>();
builder.Services.AddHttpClient<ILLMClient, HuggingFaceLLMClient>();
builder.Services.AddSingleton<IIngestionQueue, InMemoryIngestionQueue>();
builder.Services.AddHostedService<DocumentIngestionWorker>();

builder.Services.AddMediatR(cfg =>
{
    cfg.RegisterServicesFromAssembly(typeof(RegisterTenantAndOwnerCommand).Assembly);
});

var jwtSecret = builder.Configuration["Jwt:Secret"] ?? builder.Configuration["Jwt__Secret"];
if (!string.IsNullOrWhiteSpace(jwtSecret))
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
app.UseAuthentication();
app.UseHttpsRedirection();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

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
