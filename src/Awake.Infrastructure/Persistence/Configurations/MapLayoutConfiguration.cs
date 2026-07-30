using Awake.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Awake.Infrastructure.Persistence.Configurations;

public class MapLayoutConfiguration : IEntityTypeConfiguration<MapLayout>
{
    public void Configure(EntityTypeBuilder<MapLayout> builder)
    {
        builder.HasKey(x => x.Id);

        builder.Property(x => x.Location)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.Name)
            .IsRequired()
            .HasMaxLength(80);

        // jsonb, а не text: расстановка целиком читается и пишется как документ,
        // но в jsonb Postgres хотя бы проверит, что это валидный JSON
        builder.Property(x => x.Props)
            .IsRequired()
            .HasColumnType("jsonb");

        builder.HasOne(x => x.Author)
            .WithMany()
            .HasForeignKey(x => x.AuthorId)
            .OnDelete(DeleteBehavior.Cascade);

        // список расстановок всегда запрашивается по локации
        builder.HasIndex(x => x.Location);

        // имя расстановки уникально внутри локации: иначе в списке появляются
        // два «Оборона севера», и понять, какой из них свежий, нельзя
        builder.HasIndex(x => new { x.Location, x.Name }).IsUnique();
    }
}
