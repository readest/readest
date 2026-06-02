import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.DefaultTask
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.get

open class Config {
    lateinit var rootDirRel: String
}

open class RustPlugin : Plugin<Project> {
    override fun apply(project: Project) = with(project) {
        extensions.create("rust", Config::class.java)

        val abiList = listOf("arm64-v8a")
        val archList = listOf("arm64")

        extensions.configure<ApplicationExtension> {
            @Suppress("UnstableApiUsage")
            flavorDimensions.add("abi")
            productFlavors {
                create("universal") {
                    dimension = "abi"
                    ndk {
                        abiFilters += abiList
                    }
                }
                archList.forEachIndexed { index, arch ->
                    create(arch) {
                        dimension = "abi"
                        ndk {
                            abiFilters.add(abiList[index])
                        }
                    }
                }
            }
        }

        afterEvaluate {
            for (profile in listOf("debug", "release")) {
                val profileCapitalized = profile.replaceFirstChar { it.uppercase() }
                val buildTask = tasks.maybeCreate(
                    "rustBuildUniversal$profileCapitalized",
                    DefaultTask::class.java
                )
                tasks["mergeUniversal${profileCapitalized}JniLibFolders"].dependsOn(buildTask)

                val targetBuildTask = tasks.maybeCreate(
                    "rustBuildArm64$profileCapitalized",
                    DefaultTask::class.java
                )
                tasks["mergeArm64${profileCapitalized}JniLibFolders"].dependsOn(targetBuildTask)
            }
        }
    }
}
