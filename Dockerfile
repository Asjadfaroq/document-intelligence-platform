# Build stage
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copy solution and project files
COPY DocumentIntelligence.sln ./
COPY DocumentIntelligence.Api/DocumentIntelligence.Api.csproj DocumentIntelligence.Api/
COPY DocumentIntelligence.Application/DocumentIntelligence.Application.csproj DocumentIntelligence.Application/
COPY DocumentIntelligence.Domain/DocumentIntelligence.Domain.csproj DocumentIntelligence.Domain/
COPY DocumentIntelligence.Infrastructure/DocumentIntelligence.Infrastructure.csproj DocumentIntelligence.Infrastructure/

# Restore
RUN dotnet restore DocumentIntelligence.Api/DocumentIntelligence.Api.csproj

# Copy the rest of the source
COPY . .

# Publish
RUN dotnet publish DocumentIntelligence.Api/DocumentIntelligence.Api.csproj -c Release -o /app/publish --no-restore

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .

# Listen on port Render expects (PORT env var, default 10000)
ENV ASPNETCORE_URLS=http://+:${PORT:-10000}
EXPOSE 10000

ENTRYPOINT ["dotnet", "DocumentIntelligence.Api.dll"]